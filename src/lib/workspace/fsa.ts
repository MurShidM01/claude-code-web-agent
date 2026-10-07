import { BridgeError } from "@/lib/protocol/errors";
import { fileLooksSensitive } from "@/lib/safety/redact";
import { hashContent, sliceLines } from "@/lib/tools/truncate";
import { fsaErrorToBridgeError, isNotFoundError } from "@/lib/workspace/errors";
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

/**
 * Workspace backed by a folder the user picked with the File System Access
 * API. Every browser DOMException is translated into a typed BridgeError, so
 * the tool layer, the permission engine, and the UI never see raw browser
 * internals such as "A requested file or directory could not be found at the
 * time an operation was processed."
 */
export class FileSystemAccessWorkspace implements WorkspacePort {
  constructor(private handle: FileSystemDirectoryHandle) {}

  info(): WorkspaceInfo {
    return { root: this.handle.name, name: this.handle.name };
  }

  async readBinary(filePath: string, maxBytes = 6_000_000) {
    const file = await this.file(filePath, false);
    const blob = await file.getFile();
    if (blob.size > maxBytes) {
      throw new BridgeError("output_limit", `Image is ${blob.size} bytes, over the ${maxBytes} byte limit.`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return { mediaType: blob.type || mediaTypeFor(filePath), base64: btoa(binary), bytes: bytes.length };
  }

  async readFile(filePath: string, offset?: number, limit?: number): Promise<FileReadResult> {
    try {
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
        complete: !(offset || limit) && !page.truncated,
        binary: text.includes("\u0000"),
        sensitive: fileLooksSensitive(filePath),
        bytes: text.length,
      };
    } catch (error) {
      throw fsaErrorToBridgeError(error, filePath);
    }
  }

  async writeFile(filePath: string, content: string) {
    return this.withWriteAccess(filePath, async () => {
      const existed = await this.file(filePath, false).then(
        () => true,
        (error) => {
          if (isNotFoundError(error)) return false;
          throw error;
        },
      );
      const file = await this.file(filePath, true);
      await writeToHandle(file, content);
      return { path: filePath, created: !existed, bytes: content.length };
    });
  }

  async deleteFile(filePath: string, recursive = false) {
    return this.withWriteAccess(filePath, async () => {
      await this.deletePath(filePath, recursive);
      return { path: filePath };
    });
  }

  async renamePath(from: string, to: string, overwrite = false) {
    return this.withWriteAccess(`${from} → ${to}`, async () => {
      const sourceFile = await this.file(from, false).catch(() => null);
      if (sourceFile) {
        if (!overwrite && (await this.exists(to))) {
          throw new BridgeError("already_exists", `Destination exists: ${to}`);
        }
        // Binary-safe: a File is a Blob, so the bytes round-trip unchanged.
        const blob = await sourceFile.getFile();
        await writeToHandle(await this.file(to, true), blob);
        const { parent, name } = await this.parent(from, false);
        await parent.removeEntry(name);
        return { from, to };
      }
      const sourceDir = await this.directory(from, false).catch(() => null);
      if (!sourceDir) throw new BridgeError("not_found", `No such file: ${from}`);
      if (await this.exists(to)) {
        if (!overwrite) throw new BridgeError("already_exists", `Destination exists: ${to}`);
        await this.deletePath(to, true);
      }
      await this.copyTree(sourceDir, to);
      await this.deletePath(from, true);
      return { from, to };
    });
  }

  async listDirectory(dir = ".", depth = 2): Promise<DirectoryEntry> {
    try {
      const handle = dir === "." || dir === "" ? this.handle : await this.directory(dir, false);
      return await this.tree(handle, dir === "." || dir === "" ? "." : dir, depth);
    } catch (error) {
      throw fsaErrorToBridgeError(error, dir || ".");
    }
  }

  async searchFiles(input: { pattern?: string; query?: string; path?: string; glob?: string; maxResults?: number }): Promise<SearchResult> {
    try {
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
          const text = await (await handle.getFile()).text().catch(() => "");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && matches.length < max; i += 1) {
            if (regex.test(lines[i] ?? "")) matches.push({ path: child, line: i + 1, text: (lines[i] ?? "").slice(0, 400) });
          }
        }
      };
      await walk(start, prefix);
      return { matches, truncated: matches.length >= max, searchedFiles: searched };
    } catch (error) {
      throw fsaErrorToBridgeError(error, input.path ?? ".");
    }
  }

  async getFileMetadata(filePath: string): Promise<FileMetadata> {
    try {
      const file = await this.file(filePath, false).catch(() => null);
      if (file) {
        const blob = await file.getFile();
        return { path: filePath, name: file.name, kind: "file", size: blob.size, mtimeMs: blob.lastModified };
      }
      const dir = await this.directory(filePath, false).catch(() => null);
      if (dir) return { path: filePath, name: dir.name, kind: "directory", size: 0, mtimeMs: Date.now() };
      throw new BridgeError("not_found", `No such path: ${filePath}`);
    } catch (error) {
      throw fsaErrorToBridgeError(error, filePath);
    }
  }

  async mkdir(dirPath: string) {
    return this.withWriteAccess(dirPath, async () => {
      await this.directory(dirPath, true);
      return { path: dirPath };
    });
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

  /**
   * Run a mutating operation, and if the browser revoked write access (for
   * example after a reload), ask once and retry before failing.
   */
  private async withWriteAccess<T>(context: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        if (await this.requestWritePermission()) {
          try {
            return await op();
          } catch (retryError) {
            throw fsaErrorToBridgeError(retryError, context);
          }
        }
      }
      throw fsaErrorToBridgeError(error, context);
    }
  }

  private async requestWritePermission(): Promise<boolean> {
    const request = this.handle.requestPermission;
    if (!request) return false;
    try {
      return (await request.call(this.handle, { mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    return this.file(filePath, false).then(
      () => true,
      () => this.directory(filePath, false).then(
        () => true,
        () => false,
      ),
    );
  }

  private async deletePath(filePath: string, recursive: boolean): Promise<void> {
    const file = await this.file(filePath, false).catch(() => null);
    if (file) {
      const { parent, name } = await this.parent(filePath, false);
      await parent.removeEntry(name);
      return;
    }
    const dir = await this.directory(filePath, false).catch(() => null);
    if (dir) {
      const { parent, name } = await this.parent(filePath, false);
      await parent.removeEntry(name, { recursive: true });
      return;
    }
    throw new BridgeError("not_found", `No such path: ${filePath}`);
  }

  private async copyTree(source: FileSystemDirectoryHandle, destPath: string): Promise<void> {
    const dest = await this.directory(destPath, true);
    for await (const [name, child] of source.entries()) {
      if (child.kind === "file") {
        const blob = await child.getFile();
        await writeToHandle(await dest.getFileHandle(name, { create: true }), blob);
      } else {
        await this.copyTree(child, destPath === "." ? name : `${destPath}/${name}`);
      }
    }
  }

  private async tree(handle: FileSystemDirectoryHandle, rel: string, depth: number): Promise<DirectoryEntry> {
    const children: DirectoryEntry[] = [];
    for await (const [name, child] of handle.entries()) {
      if (shouldSkipDir(name)) continue;
      const childPath = rel === "." ? name : `${rel}/${name}`;
      if (child.kind === "file") {
        const size = await child.getFile().then(
          (blob) => blob.size,
          () => undefined,
        );
        children.push({ name, path: childPath, kind: "file", size });
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
    return filePath
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .split("/")
      .filter((part) => part && part !== ".");
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

function mediaTypeFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "image/jpeg";
}

async function writeToHandle(handle: FileSystemFileHandle, data: string | Blob): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.close().catch(() => undefined);
    throw error;
  }
}
