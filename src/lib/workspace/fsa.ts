import { BridgeError } from "@/lib/protocol/errors";
import { fileLooksSensitive } from "@/lib/safety/redact";
import { hashContent, sliceLines } from "@/lib/tools/truncate";
import { matchGlob, shouldSkipDir } from "@/lib/workspace/path";
import type {
  DirectoryEntry,
  FileMetadata,
  FileReadResult,
  SearchResult,
  WorkspaceInfo,
  WorkspacePort,
} from "@/lib/workspace/types";

const SHELL =
  "The File System Access API can read and write the folder you picked. Shell, git, and process control need the local execution bridge.";

export function fileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export class FileSystemAccessWorkspace implements WorkspacePort {
  constructor(private handle: FileSystemDirectoryHandle) {}

  info(): WorkspaceInfo {
    return { root: this.handle.name, name: this.handle.name };
  }

  async readFile(filePath: string, offset?: number, limit?: number): Promise<FileReadResult> {
    const file = await this.file(filePath, false);
    const text = await (await file.getFile()).text();
    const page = sliceLines(text, offset ?? 1, limit ?? 2000);
    const lines = text.split("\n");
    const pageText = lines.slice((offset ?? 1) - 1, (offset ?? 1) - 1 + (limit ?? 2000)).join("\n");
    return {
      path: filePath,
      content: offset || limit ? pageText : text,
      numbered: page.text,
      contentHash: hashContent(text),
      startLine: page.startLine,
      numLines: page.numLines,
      totalLines: page.totalLines,
      truncated: page.truncated,
      complete: true,
      binary: text.includes("\u0000"),
      sensitive: fileLooksSensitive(filePath),
      bytes: text.length,
    };
  }

  async writeFile(filePath: string, content: string) {
    const existing = await this.file(filePath, false).then(() => false).catch(() => true);
    const file = await this.file(filePath, true);
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
    return { path: filePath, created: existing, bytes: content.length };
  }

  async deleteFile(filePath: string, recursive = false) {
    const { parent, name } = await this.parent(filePath, false);
    await parent.removeEntry(name, { recursive });
    return { path: filePath };
  }

  async renamePath(from: string, to: string, overwrite = false) {
    const source = await this.file(from, false).catch(() => null);
    if (!source) throw new BridgeError("not_found", `No such file: ${from}`);
    if (!overwrite) {
      const dest = await this.file(to, false).catch(() => null);
      if (dest) throw new BridgeError("already_exists", "Destination exists.");
    }
    const content = await (await source.getFile()).text();
    await this.writeFile(to, content);
    await this.deleteFile(from);
    return { from, to };
  }

  async listDirectory(dir = ".", depth = 2): Promise<DirectoryEntry> {
    const handle = dir === "." || dir === "" ? this.handle : await this.directory(dir, false);
    return this.tree(handle, dir === "." ? "." : dir, depth);
  }

  async searchFiles(input: { pattern?: string; query?: string; path?: string; glob?: string; maxResults?: number }): Promise<SearchResult> {
    const max = input.maxResults ?? 200;
    const start = input.path && input.path !== "." ? await this.directory(input.path, false) : this.handle;
    const prefix = input.path && input.path !== "." ? input.path.replace(/\/$/, "") : "";
    const matches: SearchResult["matches"] = [];
    let searched = 0;
    let regex: RegExp | null = null;
    if (input.query) {
      try {
        regex = new RegExp(input.query, "i");
      } catch {
        throw new BridgeError("invalid_params", "Search pattern is not a valid regular expression.");
      }
    }
    const walk = async (dir: FileSystemDirectoryHandle, rel: string) => {
      for await (const [name, handle] of dir.entries()) {
        if (matches.length >= max) return;
        if (shouldSkipDir(name)) continue;
        const child = rel ? `${rel}/${name}` : name;
        if (handle.kind === "directory") {
          await walk(handle, child);
          continue;
        }
        if (input.pattern && !matchGlob(input.pattern, child)) continue;
        if (input.glob && !matchGlob(input.glob, child)) continue;
        searched += 1;
        if (!regex) {
          if (input.pattern || input.glob) matches.push({ path: child });
          continue;
        }
        const text = await (await handle.getFile()).text();
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && matches.length < max; i += 1) {
          if (regex.test(lines[i] ?? "")) matches.push({ path: child, line: i + 1, text: (lines[i] ?? "").slice(0, 400) });
        }
      }
    };
    await walk(start, prefix);
    return { matches, truncated: matches.length >= max, searchedFiles: searched };
  }

  async getFileMetadata(filePath: string): Promise<FileMetadata> {
    const file = await this.file(filePath, false).catch(async () => null);
    if (file) {
      const blob = await file.getFile();
      return { path: filePath, name: file.name, kind: "file", size: blob.size, mtimeMs: blob.lastModified };
    }
    const dir = await this.directory(filePath, false);
    return { path: filePath, name: dir.name, kind: "directory", size: 0, mtimeMs: Date.now() };
  }

  async mkdir(dirPath: string) {
    await this.directory(dirPath, true);
    return { path: dirPath };
  }

  runCommand(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }
  getProcessStatus(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }
  killProcess(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }
  gitStatus(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }
  gitDiff(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }
  gitLog(): Promise<never> {
    throw new BridgeError("capability_unavailable", SHELL);
  }

  private async tree(handle: FileSystemDirectoryHandle, rel: string, depth: number): Promise<DirectoryEntry> {
    const children: DirectoryEntry[] = [];
    for await (const [name, child] of handle.entries()) {
      if (shouldSkipDir(name)) continue;
      const childPath = rel === "." ? name : `${rel}/${name}`;
      if (child.kind === "file") {
        const blob = await child.getFile();
        children.push({ name, path: childPath, kind: "file", size: blob.size });
      } else if (depth > 1) {
        children.push(await this.tree(child, childPath, depth - 1));
      } else {
        children.push({ name, path: childPath, kind: "directory" });
      }
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    return { name: handle.name, path: rel, kind: "directory", children };
  }

  private parts(filePath: string): string[] {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter((part) => part && part !== ".");
  }

  private async directory(dirPath: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let current = this.handle;
    for (const part of this.parts(dirPath)) {
      if (part === "..") throw new BridgeError("path_escape", "Path escapes the selected folder.");
      current = await current.getDirectoryHandle(part, { create });
    }
    return current;
  }

  private async parent(filePath: string, create: boolean): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const parts = this.parts(filePath);
    const name = parts.pop();
    if (!name || name === "..") throw new BridgeError("path_escape", "Path escapes the selected folder.");
    let parent = this.handle;
    for (const part of parts) {
      if (part === "..") throw new BridgeError("path_escape", "Path escapes the selected folder.");
      parent = await parent.getDirectoryHandle(part, { create });
    }
    return { parent, name };
  }

  private async file(filePath: string, create: boolean): Promise<FileSystemFileHandle> {
    const { parent, name } = await this.parent(filePath, create);
    return parent.getFileHandle(name, { create });
  }
}
