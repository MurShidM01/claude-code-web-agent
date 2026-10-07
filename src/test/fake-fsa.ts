/**
 * In-memory implementation of the File System Access API handles, faithful to
 * the failure modes the workspace must survive: raw DOMExceptions with the
 * exact messages Chrome produces ("A requested file or directory could not be
 * found at the time an operation was processed."), type mismatches when a
 * file operation hits a directory, and transient permission denials.
 */

export const CHROME_NOT_FOUND_MESSAGE = "A requested file or directory could not be found at the time an operation was processed.";

export interface FakeFileNode {
  kind: "file";
  data: string;
}

export interface FakeDirNode {
  kind: "dir";
  children: Map<string, FakeFileNode | FakeDirNode>;
}

export type FakeNode = FakeFileNode | FakeDirNode;

export interface FakeFsOptions {
  /** Number of upcoming create operations that should fail with NotAllowedError. */
  denyCreates: number;
}

export function makeFsOptions(denyCreates = 0): FakeFsOptions {
  return { denyCreates };
}

function notFound(): DOMException {
  return new DOMException(CHROME_NOT_FOUND_MESSAGE, "NotFoundError");
}

function typeMismatch(): DOMException {
  return new DOMException("The supplied path is a directory.", "TypeMismatchError");
}

function notAllowed(): DOMException {
  return new DOMException("Write access was not granted.", "NotAllowedError");
}

export class FakeFileHandle {
  readonly kind = "file";
  constructor(
    readonly name: string,
    private node: FakeFileNode,
  ) {}

  async getFile(): Promise<File> {
    const data = this.node.data;
    return {
      size: data.length,
      lastModified: 1_700_000_000_000,
      text: async () => data,
    } as unknown as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const node = this.node;
    const chunks: string[] = [];
    const writable = {
      write: async (data: unknown) => {
        if (typeof data === "string") chunks.push(data);
        else if (data && typeof (data as { text?: unknown }).text === "function") {
          chunks.push(await (data as { text(): Promise<string> }).text());
        } else if (data instanceof Blob) chunks.push(await data.text());
        else chunks.push(new TextDecoder().decode(data as BufferSource));
      },
      close: async () => {
        node.data = chunks.join("");
      },
    };
    return writable as unknown as FileSystemWritableFileStream;
  }
}

export class FakeDirectoryHandle {
  readonly kind = "directory";
  constructor(
    readonly name: string,
    private node: FakeDirNode,
    private options: FakeFsOptions,
  ) {}

  async *entries(): AsyncIterableIterator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    for (const [name, child] of this.node.children) {
      yield [name, child.kind === "file" ? new FakeFileHandle(name, child) : new FakeDirectoryHandle(name, child, this.options)];
    }
  }

  private maybeDenyCreate(options?: { create?: boolean }) {
    if (options?.create && this.options.denyCreates > 0) {
      this.options.denyCreates -= 1;
      throw notAllowed();
    }
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    this.maybeDenyCreate(options);
    const existing = this.node.children.get(name);
    if (existing) {
      if (existing.kind !== "file") throw typeMismatch();
      return new FakeFileHandle(name, existing);
    }
    if (!options?.create) throw notFound();
    const node: FakeFileNode = { kind: "file", data: "" };
    this.node.children.set(name, node);
    return new FakeFileHandle(name, node);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectoryHandle> {
    this.maybeDenyCreate(options);
    const existing = this.node.children.get(name);
    if (existing) {
      if (existing.kind !== "dir") throw typeMismatch();
      return new FakeDirectoryHandle(name, existing, this.options);
    }
    if (!options?.create) throw notFound();
    const node: FakeDirNode = { kind: "dir", children: new Map() };
    this.node.children.set(name, node);
    return new FakeDirectoryHandle(name, node, this.options);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.node.children.get(name);
    if (!existing) throw notFound();
    if (existing.kind === "dir" && existing.children.size > 0 && !options?.recursive) {
      throw new DOMException("The directory is not empty.", "InvalidModificationError");
    }
    this.node.children.delete(name);
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }
}

export interface FakeFolder {
  root: FakeDirNode;
  handle: FakeDirectoryHandle;
  options: FakeFsOptions;
  read(path: string): string | null;
  paths(): string[];
}

/** Build a fake picked folder from a flat map of relative path -> content. */
export function makeFolder(files: Record<string, string> = {}, options: FakeFsOptions = makeFsOptions()): FakeFolder {
  const root: FakeDirNode = { kind: "dir", children: new Map() };
  for (const [filePath, data] of Object.entries(files)) {
    const parts = filePath.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let child = dir.children.get(part);
      if (!child || child.kind !== "dir") {
        child = { kind: "dir", children: new Map() };
        dir.children.set(part, child);
      }
      dir = child;
    }
    dir.children.set(parts[parts.length - 1]!, { kind: "file", data });
  }
  const handle = new FakeDirectoryHandle("project", root, options);
  const read = (filePath: string): string | null => {
    const parts = filePath.split("/");
    let node: FakeNode = root;
    for (const part of parts) {
      if (node.kind !== "dir") return null;
      const next = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node.kind === "file" ? node.data : null;
  };
  const paths = (): string[] => {
    const out: string[] = [];
    const walk = (dir: FakeDirNode, prefix: string) => {
      for (const [name, child] of dir.children) {
        const rel = prefix ? `${prefix}/${name}` : name;
        out.push(rel);
        if (child.kind === "dir") walk(child, rel);
      }
    };
    walk(root, "");
    return out.sort();
  };
  return { root, handle, options, read, paths };
}
