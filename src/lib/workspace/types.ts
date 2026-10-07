export interface FileMetadata {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  mode?: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size?: number;
  children?: DirectoryEntry[];
  truncated?: boolean;
}

export interface FileReadResult {
  path: string;
  content: string;
  numbered?: string;
  contentHash?: string;
  startLine: number;
  numLines: number;
  totalLines: number;
  truncated: boolean;
  complete?: boolean;
  binary: boolean;
  sensitive: boolean;
  bytes: number;
}

export interface SearchMatch {
  path: string;
  line?: number;
  text?: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  searchedFiles: number;
}

export interface CommandEvent {
  type: "started" | "stdout" | "stderr" | "exit" | "error";
  processId?: string;
  data?: string;
  code?: number | null;
  signal?: string | null;
  durationMs?: number;
  truncated?: boolean;
  message?: string;
}

export interface CommandResult {
  processId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  truncated: boolean;
  interrupted: boolean;
  background: boolean;
}

export interface GitStatusResult {
  branch: string;
  porcelain: string;
  clean: boolean;
}

export interface GitDiffResult {
  patch: string;
  truncated: boolean;
}

export interface GitLogEntry {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface WorkspacePort {
  info(): WorkspaceInfo | null;
  readFile(path: string, offset?: number, limit?: number): Promise<FileReadResult>;
  writeFile(path: string, content: string): Promise<{ path: string; created: boolean; bytes: number }>;
  deleteFile(path: string, recursive?: boolean): Promise<{ path: string }>;
  renamePath(from: string, to: string, overwrite?: boolean): Promise<{ from: string; to: string }>;
  listDirectory(path?: string, depth?: number): Promise<DirectoryEntry>;
  searchFiles(input: {
    pattern?: string;
    query?: string;
    path?: string;
    glob?: string;
    maxResults?: number;
  }): Promise<SearchResult>;
  getFileMetadata(path: string): Promise<FileMetadata>;
  mkdir(path: string): Promise<{ path: string }>;
  runCommand(
    input: {
      command: string;
      cwd?: string;
      timeoutMs?: number;
      background?: boolean;
      acknowledgedRisk?: boolean;
    },
    onEvent?: (event: CommandEvent) => void,
    signal?: AbortSignal,
  ): Promise<CommandResult>;
  getProcessStatus(processId: string): Promise<{
    processId: string;
    running: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
  killProcess(processId: string): Promise<{ processId: string; killed: boolean }>;
  gitStatus(): Promise<GitStatusResult>;
  gitDiff(input?: { ref?: string; staged?: boolean; path?: string }): Promise<GitDiffResult>;
  gitLog(limit?: number): Promise<GitLogEntry[]>;
}

export class WorkspaceUnavailable extends Error {
  constructor(
    message: string,
    readonly code = "workspace_unavailable",
  ) {
    super(message);
    this.name = "WorkspaceUnavailable";
  }
}
