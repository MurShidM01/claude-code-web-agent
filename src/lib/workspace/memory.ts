import { BridgeError } from "@/lib/protocol/errors";
import { fileLooksSensitive } from "@/lib/safety/redact";
import { matchGlob, relativeToRoot, resolveInRoot, shouldSkipDir } from "@/lib/workspace/path";
import { hashContent, sliceLines } from "@/lib/tools/truncate";
import type {
  CommandResult,
  DirectoryEntry,
  FileMetadata,
  FileReadResult,
  GitDiffResult,
  GitLogEntry,
  GitStatusResult,
  SearchResult,
  WorkspaceInfo,
  WorkspacePort,
} from "@/lib/workspace/types";

interface MemoryFile {
  content: string;
  mtimeMs: number;
}

/**
 * In-memory workspace used by tests and by the agent loop when no bridge is
 * connected. It is a real implementation of the port, not a fake tool result.
 */
export class MemoryWorkspace implements WorkspacePort {
  readonly files = new Map<string, MemoryFile>();
  readonly dirs = new Set<string>(["."]);
  private processes = new Map<string, { stdout: string; stderr: string; exitCode: number | null; running: boolean }>();

  constructor(readonly root = "/workspace") {}

  info(): WorkspaceInfo {
    return { root: this.root, name: this.root.split("/").pop() || "workspace" };
  }

  seed(path: string, content: string) {
    const rel = this.rel(path);
    this.ensureParents(rel);
    this.files.set(rel, { content, mtimeMs: Date.now() });
  }

  async readFile(path: string, offset?: number, limit?: number): Promise<FileReadResult> {
    const rel = this.rel(path);
    const file = this.files.get(rel);
    if (!file) throw new BridgeError("not_found", `No such file: ${rel}`);
    if (file.content.includes("\u0000")) {
      return {
        path: rel,
        content: "",
        startLine: 1,
        numLines: 0,
        totalLines: 0,
        truncated: false,
        binary: true,
        sensitive: fileLooksSensitive(rel),
        bytes: file.content.length,
      };
    }
    const paged = offset !== undefined || limit !== undefined;
    const sliced = sliceLines(file.content, offset ?? 1, limit ?? 2000);
    const lines = file.content.split("\n");
    const pageText = lines.slice((offset ?? 1) - 1, (offset ?? 1) - 1 + (limit ?? 2000)).join("\n");
    return {
      path: rel,
      content: paged ? pageText : file.content,
      numbered: sliced.text,
      contentHash: hashContent(file.content),
      startLine: sliced.startLine,
      numLines: sliced.numLines,
      totalLines: sliced.totalLines,
      truncated: sliced.truncated,
      complete: !paged && !sliced.truncated,
      binary: false,
      sensitive: fileLooksSensitive(rel),
      bytes: file.content.length,
    };
  }

  async writeFile(path: string, content: string) {
    const rel = this.rel(path);
    const created = !this.files.has(rel);
    this.ensureParents(rel);
    this.files.set(rel, { content, mtimeMs: Date.now() });
    return { path: rel, created, bytes: content.length };
  }

  async deleteFile(path: string, recursive = false) {
    const rel = this.rel(path);
    if (this.files.has(rel)) {
      this.files.delete(rel);
      return { path: rel };
    }
    const prefix = `${rel}/`;
    const nested = [...this.files.keys()].filter((key) => key.startsWith(prefix));
    const dir = [...this.dirs].some((dir) => dir === rel || dir.startsWith(prefix));
    if (!dir && !nested.length) throw new BridgeError("not_found", `No such path: ${rel}`);
    if (nested.length && !recursive) throw new BridgeError("invalid_params", "Directory is not empty. Pass recursive to delete it.");
    for (const key of nested) this.files.delete(key);
    for (const dir of [...this.dirs]) {
      if (dir === rel || dir.startsWith(prefix)) this.dirs.delete(dir);
    }
    return { path: rel };
  }

  async renamePath(from: string, to: string, overwrite = false) {
    const source = this.rel(from);
    const dest = this.rel(to);
    if (!overwrite && (this.files.has(dest) || this.dirs.has(dest))) {
      throw new BridgeError("already_exists", `Destination exists: ${dest}`);
    }
    if (this.files.has(source)) {
      const file = this.files.get(source)!;
      this.files.delete(source);
      this.ensureParents(dest);
      this.files.set(dest, { ...file, mtimeMs: Date.now() });
      return { from: source, to: dest };
    }
    throw new BridgeError("not_found", `No such path: ${source}`);
  }

  async listDirectory(path = ".", depth = 2): Promise<DirectoryEntry> {
    const rel = path === "." || path === "" ? "." : this.rel(path);
    return this.tree(rel, depth);
  }

  async searchFiles(input: { pattern?: string; query?: string; path?: string; glob?: string; maxResults?: number }): Promise<SearchResult> {
    const max = input.maxResults ?? 200;
    const root = input.path ? this.rel(input.path) : ".";
    if (root !== "." && !this.dirs.has(root)) throw new BridgeError("not_found", `No such directory: ${root}`);
    const matches = [];
    let searched = 0;
    for (const [file, data] of this.files) {
      if (root !== "." && file !== root && !file.startsWith(`${root}/`)) continue;
      if (input.pattern && !matchGlob(input.pattern, file) && !matchGlob(input.pattern, file.split("/").pop() ?? file)) continue;
      if (input.glob && !matchGlob(input.glob, file)) continue;
      searched += 1;
      if (!input.query) {
        if (!input.pattern && !input.glob) continue;
        matches.push({ path: file });
      } else {
        let regex: RegExp;
        try {
          regex = new RegExp(input.query, "i");
        } catch {
          throw new BridgeError("invalid_params", "Search pattern is not a valid regular expression.");
        }
        const lines = data.content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          if (regex.test(lines[i] ?? "")) {
            matches.push({ path: file, line: i + 1, text: (lines[i] ?? "").slice(0, 400) });
            if (matches.length >= max) return { matches, truncated: true, searchedFiles: searched };
          }
        }
      }
      if (matches.length >= max) return { matches, truncated: true, searchedFiles: searched };
    }
    return { matches, truncated: false, searchedFiles: searched };
  }

  async getFileMetadata(path: string): Promise<FileMetadata> {
    const rel = this.rel(path);
    const file = this.files.get(rel);
    if (!file && !this.dirs.has(rel)) throw new BridgeError("not_found", `No such path: ${rel}`);
    return {
      path: rel,
      name: rel.split("/").pop() || rel,
      kind: file ? "file" : "directory",
      size: file?.content.length ?? 0,
      mtimeMs: file?.mtimeMs ?? Date.now(),
    };
  }

  async mkdir(path: string) {
    const rel = this.rel(path);
    this.ensureParents(rel);
    this.dirs.add(rel);
    return { path: rel };
  }

  async runCommand(input: { command: string; background?: boolean }): Promise<CommandResult> {
    const processId = `mem_${this.processes.size + 1}`;
    const stdout = `memory-workspace cannot execute shell commands (${input.command})`;
    this.processes.set(processId, { stdout, stderr: "", exitCode: 127, running: false });
    return {
      processId,
      stdout,
      stderr: "capability_unavailable: connect the local execution bridge to run commands.",
      exitCode: 127,
      signal: null,
      durationMs: 0,
      truncated: false,
      interrupted: false,
      background: false,
    };
  }

  async getProcessStatus(processId: string) {
    const proc = this.processes.get(processId);
    if (!proc) throw new BridgeError("process_not_found", "No such process.");
    return { processId, running: proc.running, exitCode: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
  }

  async killProcess(processId: string) {
    return { processId, killed: this.processes.delete(processId) };
  }

  async gitStatus(): Promise<GitStatusResult> {
    throw new BridgeError("capability_unavailable", "Git requires the local execution bridge.");
  }

  async gitDiff(): Promise<GitDiffResult> {
    throw new BridgeError("capability_unavailable", "Git requires the local execution bridge.");
  }

  async gitLog(): Promise<GitLogEntry[]> {
    throw new BridgeError("capability_unavailable", "Git requires the local execution bridge.");
  }

  private rel(input: string): string {
    const resolved = resolveInRoot(this.root, input.startsWith(this.root) ? input : input);
    return relativeToRoot(this.root, resolved);
  }

  private ensureParents(rel: string) {
    const parts = rel.split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      current = current ? `${current}/${parts[i]}` : parts[i]!;
      this.dirs.add(current);
    }
  }

  private tree(rel: string, depth: number): DirectoryEntry {
    const name = rel === "." ? this.info().name : rel.split("/").pop() || rel;
    const children: DirectoryEntry[] = [];
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (rel !== "." && !file.startsWith(`${rel}/`)) continue;
      const rest = rel === "." ? file : file.slice(rel.length + 1);
      names.add(rest.split("/")[0]!);
    }
    for (const dir of this.dirs) {
      if (dir === ".") continue;
      if (rel !== "." && dir !== rel && !dir.startsWith(`${rel}/`)) continue;
      const rest = rel === "." ? dir : dir.startsWith(`${rel}/`) ? dir.slice(rel.length + 1) : "";
      if (rest) names.add(rest.split("/")[0]!);
    }
    for (const child of [...names].sort()) {
      if (shouldSkipDir(child)) continue;
      const childPath = rel === "." ? child : `${rel}/${child}`;
      const isFile = this.files.has(childPath);
      if (isFile) children.push({ name: child, path: childPath, kind: "file", size: this.files.get(childPath)?.content.length });
      else if (depth > 1) children.push(this.tree(childPath, depth - 1));
      else children.push({ name: child, path: childPath, kind: "directory" });
    }
    return { name, path: rel, kind: "directory", children };
  }
}
