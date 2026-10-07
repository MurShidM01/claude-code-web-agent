import { BridgeError, type BridgeErrorCode } from "@/lib/protocol/errors";
import type { BridgeMethod } from "@/lib/protocol/schema";
import type {
  CommandEvent,
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

export interface BridgeHealth {
  version: number;
  pid: number;
  suggestedRoot: string | null;
  workspace: WorkspaceInfo | null;
  capabilities: string[];
}

export interface BridgeTransport {
  request<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>;
  stream(path: string, body: unknown, onEvent: (event: CommandEvent) => void, signal?: AbortSignal): Promise<void>;
}

export class BridgeClient implements WorkspacePort {
  private workspace: WorkspaceInfo | null = null;

  constructor(private transport: BridgeTransport) {}

  info(): WorkspaceInfo | null {
    return this.workspace;
  }

  setInfo(info: WorkspaceInfo | null) {
    this.workspace = info;
  }

  async health(): Promise<BridgeHealth> {
    return this.transport.request<BridgeHealth>("/health");
  }

  async pair(code: string): Promise<{ token: string }> {
    return this.transport.request("/pair", { method: "POST", body: { code } });
  }

  async selectWorkspace(root: string): Promise<WorkspaceInfo> {
    const info = await this.transport.request<WorkspaceInfo>("/workspace", { method: "POST", body: { root } });
    this.workspace = info;
    return info;
  }

  private rpc<T>(method: BridgeMethod, params?: unknown, signal?: AbortSignal): Promise<T> {
    return this.transport.request<{ ok: true; result: T }>("/rpc", {
      method: "POST",
      body: { id: crypto.randomUUID(), method, params: params ?? {} },
      signal,
    }).then((response) => response.result);
  }

  readFile(path: string, offset?: number, limit?: number) {
    return this.rpc<FileReadResult>("readFile", { path, offset, limit });
  }
  readBinary(path: string, maxBytes?: number) {
    return this.rpc<{ mediaType: string; base64: string; bytes: number }>("readBinary", { path, maxBytes });
  }
  writeFile(path: string, content: string) {
    return this.rpc<{ path: string; created: boolean; bytes: number }>("writeFile", { path, content });
  }
  deleteFile(path: string, recursive?: boolean) {
    return this.rpc<{ path: string }>("deleteFile", { path, recursive });
  }
  renamePath(from: string, to: string, overwrite?: boolean) {
    return this.rpc<{ from: string; to: string }>("renamePath", { from, to, overwrite });
  }
  listDirectory(path?: string, depth?: number) {
    return this.rpc<DirectoryEntry>("listDirectory", { path, depth });
  }
  searchFiles(input: { pattern?: string; query?: string; path?: string; glob?: string; maxResults?: number }) {
    return this.rpc<SearchResult>("searchFiles", input);
  }
  getFileMetadata(path: string) {
    return this.rpc<FileMetadata>("getFileMetadata", { path });
  }
  mkdir(path: string) {
    return this.rpc<{ path: string }>("mkdir", { path });
  }
  gitStatus() {
    return this.rpc<GitStatusResult>("gitStatus", {});
  }
  gitDiff(input?: { ref?: string; staged?: boolean; path?: string }) {
    return this.rpc<GitDiffResult>("gitDiff", input ?? {});
  }
  gitLog(limit?: number) {
    return this.rpc<GitLogEntry[]>("gitLog", { limit });
  }
  getProcessStatus(processId: string) {
    return this.rpc<{ processId: string; running: boolean; exitCode: number | null; stdout: string; stderr: string }>(
      "getProcessStatus",
      { processId },
    );
  }
  killProcess(processId: string) {
    return this.rpc<{ processId: string; killed: boolean }>("killProcess", { processId });
  }

  async runCommand(
    input: {
      command: string;
      cwd?: string;
      timeoutMs?: number;
      background?: boolean;
      acknowledgedRisk?: boolean;
    },
    onEvent?: (event: CommandEvent) => void,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    let stdout = "";
    let stderr = "";
    let result: CommandResult | null = null;
    await this.transport.stream(
      "/exec",
      input,
      (event) => {
        onEvent?.(event);
        if (event.type === "stdout" && event.data) stdout += event.data;
        if (event.type === "stderr" && event.data) stderr += event.data;
        if (event.type === "exit" || event.type === "error") {
          result = {
            processId: event.processId ?? "unknown",
            stdout,
            stderr: event.type === "error" && event.message ? `${stderr}${event.message}` : stderr,
            exitCode: event.code ?? (event.type === "error" ? 1 : null),
            signal: event.signal ?? null,
            durationMs: event.durationMs ?? 0,
            truncated: Boolean(event.truncated),
            interrupted: event.signal === "SIGTERM" || event.signal === "SIGINT",
            background: false,
          };
        }
        if (event.type === "started" && input.background) {
          result = {
            processId: event.processId ?? "unknown",
            stdout: "",
            stderr: "",
            exitCode: null,
            signal: null,
            durationMs: 0,
            truncated: false,
            interrupted: false,
            background: true,
          };
        }
      },
      signal,
    );
    if (!result) {
      throw new BridgeError("internal", "Command stream ended without a result.");
    }
    return result;
  }
}

export function httpTransport(baseUrl: string, token?: string | null): BridgeTransport {
  const headers = (extra?: HeadersInit): Headers => {
    const h = new Headers(extra);
    if (token) h.set("authorization", `Bearer ${token}`);
    return h;
  };
  return {
    async request(path, init) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: headers(init?.body ? { "content-type": "application/json" } : undefined),
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: init?.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        const error = data?.error ?? data;
        throw new BridgeError(
          (error?.code as BridgeErrorCode) || "internal",
          error?.message || `Bridge request failed (${response.status})`,
          error?.details,
        );
      }
      return data;
    },
    async stream(path, body, onEvent, signal) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        const error = data?.error ?? data;
        throw new BridgeError(
          (error?.code as BridgeErrorCode) || "internal",
          error?.message || `Bridge stream failed (${response.status})`,
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          onEvent(JSON.parse(line) as CommandEvent);
        }
      }
      if (buffer.trim()) onEvent(JSON.parse(buffer) as CommandEvent);
    },
  };
}

export function proxiedTransport(): BridgeTransport {
  return httpTransport("/api/bridge");
}

export function directTransport(host: string, port: number, token: string): BridgeTransport {
  return httpTransport(`http://${host}:${port}/v1`, token);
}
