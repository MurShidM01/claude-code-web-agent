import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeAuthListener, handleProviderRequest } from "../../src/lib/providers/server";
import { PROTOCOL_VERSION } from "../../src/lib/protocol/errors";
import { BridgeError } from "../../src/lib/protocol/errors";
import { paramSchema, rpcRequest } from "../../src/lib/protocol/schema";
import { assessCommand } from "../../src/lib/safety/commands";
import { fileLooksSensitive } from "../../src/lib/safety/redact";
import { hashContent, sliceLines } from "../../src/lib/tools/truncate";
import { PathEscapeError, matchGlob, relativeToRoot, resolveInRoot, shouldSkipDir } from "../../src/lib/workspace/path";

const MAX_BODY = 8_000_000;
const MAX_OUTPUT = 1_000_000;
const MAX_READ = 1_000_000;
const MAX_SEARCH_FILE = 1_000_000;
const MAX_PROCESSES = 32;

interface BridgeOptions {
  host: string;
  port: number;
  suggestedRoot: string | null;
  tokenFile: string | null;
}

interface ProcessRecord {
  id: string;
  child: ChildProcess;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  running: boolean;
  startedAt: number;
  truncated: boolean;
  listeners: Set<(line: string) => void>;
}

export interface RunningBridge {
  port: number;
  token: string;
  code: string;
  close: () => Promise<void>;
}

export async function startBridge(options: Partial<BridgeOptions> = {}): Promise<RunningBridge> {
  const host = options.host ?? "127.0.0.1";
  const token = randomBytes(32).toString("hex");
  const code = makeCode();
  let workspaceRoot: string | null = null;
  const processes = new Map<string, ProcessRecord>();
  const sockets = new Set<Socket>();

  const server = createServer(async (req, res) => {
    try {
      setCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (req.method === "GET" && pathname === "/v1/health") {
        await requireAuth(req, token);
        sendJson(res, 200, {
          version: PROTOCOL_VERSION,
          pid: process.pid,
          suggestedRoot: options.suggestedRoot,
          workspace: workspaceRoot ? info(workspaceRoot) : null,
          capabilities: ["fs", "shell", "git", "process"],
        });
        return;
      }
      if (req.method === "POST" && pathname === "/v1/pair") {
        const body = await readBody(req);
        const given = String(body.code ?? "");
        if (!safeEqual(given, code) && !safeEqual(given, token)) {
          throw new BridgeError("unauthenticated", "Pairing code was not recognized.");
        }
        sendJson(res, 200, { token });
        return;
      }
      await requireAuth(req, token);
      if (pathname.startsWith("/v1/oauth") || pathname.startsWith("/v1/providers") || pathname === "/v1/models" || pathname === "/v1/chat") {
        await serveProvider(req, res, url, pathname);
        return;
      }
      if (req.method === "POST" && pathname === "/v1/workspace") {
        const body = await readBody(req);
        const root = String(body.root ?? "");
        if (!root) throw new BridgeError("invalid_params", "root is required.");
        const resolved = path.resolve(root);
        const st = await stat(resolved).catch(() => null);
        if (!st) throw new BridgeError("not_found", `No such directory: ${root}`);
        if (!st.isDirectory()) throw new BridgeError("not_a_directory", "Workspace root must be a directory.");
        workspaceRoot = await realpath(resolved);
        sendJson(res, 200, info(workspaceRoot));
        return;
      }
      if (req.method === "POST" && pathname === "/v1/rpc") {
        const body = rpcRequest.parse(await readBody(req));
        const schema = paramSchema[body.method];
        const params = schema.parse(body.params ?? {});
        const result = await dispatch(body.method, params, {
          root: requireRoot(workspaceRoot),
          processes,
        });
        sendJson(res, 200, { ok: true, id: body.id, result });
        return;
      }
      if (req.method === "POST" && pathname === "/v1/exec") {
        const params = paramSchema.runCommand.parse(await readBody(req));
        await streamCommand(res, params, requireRoot(workspaceRoot), processes);
        return;
      }
      throw new BridgeError("method_not_found", `No route for ${req.method} ${pathname}`);
    } catch (error) {
      const bridgeError =
        error instanceof BridgeError
          ? error
          : error instanceof PathEscapeError
            ? new BridgeError("path_escape", error.message)
          : error instanceof Error && error.name === "ZodError"
            ? new BridgeError("invalid_params", "Request failed schema validation.", { issues: error.message })
            : new BridgeError("internal", error instanceof Error ? error.message : "Bridge error");
      if (!res.headersSent) {
        const status = statusFor(bridgeError.code);
        sendJson(res, status, { ok: false, error: bridgeError.toJSON() });
      } else {
        res.end();
      }
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 0;

  if (options.tokenFile) {
    await mkdir(path.dirname(options.tokenFile), { recursive: true });
    await writeFile(
      options.tokenFile,
      JSON.stringify({ version: PROTOCOL_VERSION, host, port, token, code, startedAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    );
  }

  return {
    port,
    token,
    code,
    close: () =>
      new Promise((resolve) => {
        // Stop spawned commands first so nothing outlives the bridge, then
        // destroy open connections — server.close() alone waits on keep-alive
        // and streaming sockets and would hang shutdown.
        void (async () => {
          await closeAuthListener().catch(() => undefined);
          for (const proc of processes.values()) {
            if (proc.running) killTree(proc.child);
          }
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
          setTimeout(resolve, 1_000).unref();
        })();
      }),
  };
}

function info(root: string) {
  return { root, name: path.basename(root) };
}

function requireRoot(root: string | null): string {
  if (!root) throw new BridgeError("workspace_required", "Select a workspace before using local tools.");
  return root;
}

async function dispatch(
  method: string,
  params: Record<string, unknown>,
  ctx: { root: string; processes: Map<string, ProcessRecord> },
) {
  switch (method) {
    case "readFile":
      return readWorkspaceFile(ctx.root, String(params.path), numberOr(params.offset), numberOr(params.limit));
    case "readBinary":
      return readWorkspaceBinary(ctx.root, String(params.path), numberOr(params.maxBytes) ?? 6_000_000);
    case "writeFile":
      return writeWorkspaceFile(ctx.root, String(params.path), String(params.content ?? ""));
    case "deleteFile":
      return deleteWorkspacePath(ctx.root, String(params.path), params.recursive === true);
    case "renamePath":
      return renameWorkspacePath(ctx.root, String(params.from), String(params.to), params.overwrite === true);
    case "listDirectory":
      return listTree(ctx.root, params.path ? String(params.path) : ".", numberOr(params.depth) ?? 2);
    case "searchFiles":
      return searchWorkspace(ctx.root, params);
    case "getFileMetadata":
      return metadata(ctx.root, String(params.path));
    case "mkdir": {
      const target = await jail(ctx.root, String(params.path));
      await mkdir(target, { recursive: true });
      return { path: relativeToRoot(ctx.root, target) };
    }
    case "gitStatus":
      return gitStatus(ctx.root);
    case "gitDiff":
      return gitDiff(ctx.root, params);
    case "gitLog":
      return gitLog(ctx.root, numberOr(params.limit) ?? 15);
    case "getProcessStatus":
      return processStatus(ctx.processes, String(params.processId));
    case "killProcess":
      return killProcess(ctx.processes, String(params.processId));
    default:
      throw new BridgeError("method_not_found", `Unknown method ${method}`);
  }
}

async function jail(root: string, input: string): Promise<string> {
  const resolved = resolveInRoot(root, input);
  const native = path.resolve(resolved);
  try {
    const real = await realpath(native);
    const realRoot = await realpath(root);
    resolveInRoot(realRoot, relativeToRoot(realRoot, real) === "." ? "." : real);
    const rel = path.relative(realRoot, real);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new BridgeError("path_escape", `Path escapes the workspace: ${input}`);
    return real;
  } catch (error) {
    if (error instanceof BridgeError || error instanceof PathEscapeError) throw error;
    const parent = path.dirname(native);
    try {
      const realParent = await realpath(parent);
      const realRoot = await realpath(root);
      const rel = path.relative(realRoot, realParent);
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new BridgeError("path_escape", `Path escapes the workspace: ${input}`);
    } catch (parentError) {
      if (parentError instanceof BridgeError) throw parentError;
    }
    return native;
  }
}

async function readWorkspaceBinary(root: string, input: string, maxBytes: number) {
  const target = await jail(root, input);
  const st = await stat(target).catch(() => null);
  if (!st) throw new BridgeError("not_found", `No such file: ${input}`);
  if (st.isDirectory()) throw new BridgeError("not_a_file", "Path is a directory.");
  if (st.size > maxBytes) throw new BridgeError("output_limit", `Image is ${st.size} bytes, over the ${maxBytes} byte limit.`);
  const raw = await readFile(target);
  return {
    mediaType: mediaTypeFor(target),
    base64: raw.toString("base64"),
    bytes: raw.length,
  };
}

function mediaTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/jpeg";
}

async function readWorkspaceFile(root: string, input: string, offset?: number, limit?: number) {
  const target = await jail(root, input);
  const st = await stat(target).catch(() => null);
  if (!st) throw new BridgeError("not_found", `No such file: ${input}`);
  if (st.isDirectory()) throw new BridgeError("not_a_file", "Path is a directory. Use listDirectory.");
  if (st.size > MAX_READ && !offset && !limit) {
    throw new BridgeError("output_limit", "File is too large to read at once. Pass offset and limit.");
  }
  const raw = await readFile(target);
  if (raw.subarray(0, 8000).includes(0)) {
    return {
      path: relativeToRoot(root, target),
      content: "",
      contentHash: hashContent(`binary:${st.size}`),
      startLine: 1,
      numLines: 0,
      totalLines: 0,
      truncated: false,
      binary: true,
      sensitive: fileLooksSensitive(input),
      bytes: st.size,
    };
  }
  const text = raw.toString("utf8");
  const page = sliceLines(text, offset ?? 1, limit ?? 2000);
  const pageText = text
    .split("\n")
    .slice((offset ?? 1) - 1, (offset ?? 1) - 1 + (limit ?? 2000))
    .join("\n");
  const paged = offset !== undefined || limit !== undefined;
  return {
    path: relativeToRoot(root, target),
    content: paged ? pageText : text.slice(0, MAX_READ),
    numbered: page.text,
    contentHash: hashContent(text),
    startLine: page.startLine,
    numLines: page.numLines,
    totalLines: page.totalLines,
    truncated: page.truncated || text.length > MAX_READ,
    complete: !paged && text.length <= MAX_READ,
    binary: false,
    sensitive: fileLooksSensitive(input),
    bytes: st.size,
  };
}

async function writeWorkspaceFile(root: string, input: string, content: string) {
  if (content.length > MAX_BODY) throw new BridgeError("output_limit", "File content exceeds the 8MB write limit.");
  const target = await jail(root, input);
  await mkdir(path.dirname(target), { recursive: true });
  let created = true;
  try {
    await stat(target);
    created = false;
  } catch {
    created = true;
  }
  // Atomic write: stage the content in a sibling temp file, then rename it
  // over the target. A crash mid-write can never leave a half-written file.
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.kiln-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { path: relativeToRoot(root, target), created, bytes: Buffer.byteLength(content) };
}

async function deleteWorkspacePath(root: string, input: string, recursive: boolean) {
  const target = await jail(root, input);
  const st = await stat(target).catch(() => null);
  if (!st) throw new BridgeError("not_found", `No such path: ${input}`);
  await rm(target, { recursive: recursive || st.isFile(), force: false });
  return { path: relativeToRoot(root, target) };
}

async function renameWorkspacePath(root: string, from: string, to: string, overwrite: boolean) {
  const source = await jail(root, from);
  const dest = await jail(root, to);
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat) throw new BridgeError("not_found", `No such path: ${from}`);
  if (!overwrite) {
    const exists = await stat(dest).then(() => true).catch(() => false);
    if (exists) throw new BridgeError("already_exists", "Destination exists. Pass overwrite only when replacement is intended.");
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(source, dest);
  return { from: relativeToRoot(root, source), to: relativeToRoot(root, dest) };
}

async function metadata(root: string, input: string) {
  const target = await jail(root, input);
  const st = await stat(target).catch(() => null);
  if (!st) throw new BridgeError("not_found", `No such path: ${input}`);
  return {
    path: relativeToRoot(root, target),
    name: path.basename(target),
    kind: st.isDirectory() ? "directory" : st.isSymbolicLink() ? "symlink" : "file",
    size: st.size,
    mtimeMs: st.mtimeMs,
    mode: st.mode,
  };
}

async function listTree(root: string, input: string, depth: number) {
  const { readdir } = await import("node:fs/promises");
  const target = await jail(root, input);
  const st = await stat(target).catch(() => null);
  if (!st) throw new BridgeError("not_found", `No such directory: ${input}`);
  if (!st.isDirectory()) throw new BridgeError("not_a_directory", "listDirectory requires a directory.");
  const walk = async (dir: string, levels: number): Promise<{ name: string; path: string; kind: "file" | "directory"; size?: number; children?: unknown[]; truncated?: boolean }> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const children = [];
    let truncated = false;
    const visible = entries.filter((entry) => !shouldSkipDir(entry.name)).slice(0, 400);
    if (visible.length < entries.filter((entry) => !shouldSkipDir(entry.name)).length) truncated = true;
    for (const entry of visible) {
      const full = path.join(dir, entry.name);
      const rel = relativeToRoot(root, full);
      if (entry.isDirectory()) {
        children.push(levels > 1 ? { ...(await walk(full, levels - 1)), name: entry.name, path: rel } : { name: entry.name, path: rel, kind: "directory" as const });
      } else {
        const stFile = await stat(full).catch(() => null);
        children.push({ name: entry.name, path: rel, kind: "file" as const, size: stFile?.size });
      }
    }
    return { name: path.basename(dir), path: relativeToRoot(root, dir), kind: "directory", children, truncated };
  };
  return walk(target, Math.min(depth, 4));
}

async function searchWorkspace(root: string, params: Record<string, unknown>) {
  const { readdir } = await import("node:fs/promises");
  const start = await jail(root, params.path ? String(params.path) : ".");
  const startStat = await stat(start).catch(() => null);
  if (!startStat) throw new BridgeError("not_found", `No such directory: ${params.path ?? "."}`);
  if (!startStat.isDirectory()) throw new BridgeError("not_a_directory", "searchFiles requires a directory.");
  const max = Math.min(numberOr(params.maxResults) ?? 200, 500);
  const pattern = params.pattern ? String(params.pattern) : "";
  const glob = params.glob ? String(params.glob) : "";
  const query = params.query ? String(params.query) : "";
  let regex: RegExp | null = null;
  if (query) {
    try {
      regex = new RegExp(query, "i");
    } catch {
      throw new BridgeError("invalid_params", "Search pattern is not a valid regular expression.");
    }
  }
  const matches: { path: string; line?: number; text?: string }[] = [];
  let searched = 0;
  const stack = [start];
  while (stack.length && matches.length < max) {
    const dir = stack.pop()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (matches.length >= max) break;
      if (shouldSkipDir(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relativeToRoot(root, full);
      if (pattern && !matchGlob(pattern, rel)) continue;
      if (glob && !matchGlob(glob, rel)) continue;
      // Skip oversized files so a search over a huge tree stays responsive.
      const fileStat = await stat(full).catch(() => null);
      if (!fileStat || fileStat.size > MAX_SEARCH_FILE) continue;
      searched += 1;
      if (!regex) {
        if (pattern || glob) matches.push({ path: rel });
        continue;
      }
      const text = await readFile(full, "utf8").catch(() => "");
      if (text.includes("\u0000")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && matches.length < max; i += 1) {
        if (regex.test(lines[i] ?? "")) matches.push({ path: rel, line: i + 1, text: (lines[i] ?? "").slice(0, 400) });
      }
    }
  }
  return { matches, truncated: matches.length >= max, searchedFiles: searched };
}

async function gitStatus(root: string) {
  const result = await execGit(root, ["status", "--porcelain=v1", "-b"]);
  const branch = result.stdout.split("\n")[0]?.replace(/^##\s*/, "") ?? "";
  return { branch, porcelain: result.stdout, clean: result.stdout.trim().split("\n").filter((line) => line && !line.startsWith("##")).length === 0 };
}

async function gitDiff(root: string, params: Record<string, unknown>) {
  const args = ["diff", "--no-ext-diff"];
  if (params.staged === true) args.push("--cached");
  if (params.ref) args.push(String(params.ref));
  if (params.path) args.push("--", String(params.path));
  const result = await execGit(root, args);
  const truncated = result.stdout.length > 200_000;
  return { patch: truncated ? result.stdout.slice(0, 200_000) : result.stdout, truncated };
}

async function gitLog(root: string, limit: number) {
  const result = await execGit(root, ["log", `-n`, String(limit), "--pretty=format:%H%x09%an%x09%ad%x09%s", "--date=short"]);
  if (!result.stdout.trim()) return [];
  return result.stdout.split("\n").map((line) => {
    const [sha = "", author = "", date = "", subject = ""] = line.split("\t");
    return { sha, author, date, subject };
  });
}

function execGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, env: filteredEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new BridgeError("internal", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code && code !== 0 && /not a git repository/i.test(stderr)) {
        reject(new BridgeError("not_found", "This workspace is not a git repository."));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

async function streamCommand(
  res: ServerResponse,
  params: { command: string; cwd?: string; timeoutMs?: number; background?: boolean; acknowledgedRisk?: boolean },
  root: string,
  processes: Map<string, ProcessRecord>,
) {
  const assessment = assessCommand(params.command);
  if (assessment.blocked) {
    throw new BridgeError("dangerous_blocked", assessment.reasons.join(" "));
  }
  if (assessment.critical && !params.acknowledgedRisk) {
    throw new BridgeError("forbidden", "This command is dangerous and was not explicitly acknowledged.");
  }
  const cwd = params.cwd ? await jail(root, params.cwd) : root;
  const running = [...processes.values()].filter((proc) => proc.running).length;
  if (running >= MAX_PROCESSES) {
    throw new BridgeError("internal", `Too many running processes (limit ${MAX_PROCESSES}). Stop one with killProcess before starting another.`);
  }
  const id = `proc_${randomBytes(4).toString("hex")}`;
  const child = spawn(params.command, {
    cwd,
    shell: true,
    env: filteredEnv(),
    detached: process.platform !== "win32",
  });
  const record: ProcessRecord = {
    id,
    child,
    command: params.command,
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
    running: true,
    startedAt: Date.now(),
    truncated: false,
    listeners: new Set(),
  };
  processes.set(id, record);
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": String(res.getHeader("access-control-allow-origin") ?? "*"),
  });
  const write = (event: Record<string, unknown>) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  write({ type: "started", processId: id });
  if (params.background) {
    attachOutput(record, MAX_OUTPUT);
    res.end();
    return;
  }
  const timeoutMs = Math.min(params.timeoutMs ?? 120_000, 600_000);
  const timer = setTimeout(() => {
    killTree(child);
    record.signal = "SIGTERM";
  }, timeoutMs);
  child.stdout?.on("data", (chunk) => {
    const data = appendCapped(record, "stdout", chunk.toString(), MAX_OUTPUT);
    if (data) write({ type: "stdout", processId: id, data });
  });
  child.stderr?.on("data", (chunk) => {
    const data = appendCapped(record, "stderr", chunk.toString(), MAX_OUTPUT);
    if (data) write({ type: "stderr", processId: id, data });
  });
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    record.running = false;
    record.exitCode = code;
    record.signal = signal;
    write({
      type: "exit",
      processId: id,
      code,
      signal,
      durationMs: Date.now() - record.startedAt,
      truncated: record.truncated,
    });
    res.end();
  });
  child.on("error", (error) => {
    clearTimeout(timer);
    record.running = false;
    write({ type: "error", processId: id, message: error.message, code: 1 });
    res.end();
  });
  res.on("close", () => {
    if (record.running) killTree(child);
  });
}

function attachOutput(record: ProcessRecord, cap: number) {
  record.child.stdout?.on("data", (chunk) => appendCapped(record, "stdout", chunk.toString(), cap));
  record.child.stderr?.on("data", (chunk) => appendCapped(record, "stderr", chunk.toString(), cap));
  record.child.on("close", (code, signal) => {
    record.running = false;
    record.exitCode = code;
    record.signal = signal;
  });
}

function appendCapped(record: ProcessRecord, field: "stdout" | "stderr", data: string, cap: number): string {
  if (record[field].length >= cap) {
    record.truncated = true;
    return "";
  }
  const room = cap - record[field].length;
  const slice = data.slice(0, room);
  record[field] += slice;
  if (slice.length < data.length) record.truncated = true;
  return slice;
}

function processStatus(processes: Map<string, ProcessRecord>, processId: string) {
  const record = processes.get(processId);
  if (!record) throw new BridgeError("process_not_found", "No such process.");
  return {
    processId,
    running: record.running,
    exitCode: record.exitCode,
    stdout: record.stdout.slice(-100_000),
    stderr: record.stderr.slice(-40_000),
  };
}

function killProcess(processes: Map<string, ProcessRecord>, processId: string) {
  const record = processes.get(processId);
  if (!record) throw new BridgeError("process_not_found", "No such process.");
  if (record.running) killTree(record.child);
  record.running = false;
  return { processId, killed: true };
}

function killTree(child: ChildProcess) {
  if (process.platform === "win32") {
    // child.kill() only signals the shell wrapper on Windows; taskkill /T
    // takes down the whole process tree (e.g. `npm run dev` and its children).
    if (child.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        return;
      } catch {
        // Fall through to a direct kill.
      }
    }
    child.kill();
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall through to a direct kill.
    }
  }
  child.kill("SIGTERM");
}

function filteredEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TMP", "TEMP", "NODE_ENV", "CI", "EDITOR", "VISUAL", "PWD", "GIT_EDITOR", "GIT_PAGER", "PAGER"];
  if (process.platform === "win32") {
    // Without these, cmd.exe and common tools misbehave or fail to start:
    // SystemRoot is required by the shell itself, PATHEXT/COMSPEC by command
    // resolution, and the profile variables by git, node, and npm.
    allow.push(
      "SYSTEMROOT",
      "SYSTEMDRIVE",
      "WINDIR",
      "COMSPEC",
      "PATHEXT",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PROGRAMFILES",
      "PROGRAMFILES(X86)",
      "PROGRAMDATA",
      "ALLUSERSPROFILE",
      "COMMONPROGRAMFILES",
      "NUMBER_OF_PROCESSORS",
      "PROCESSOR_ARCHITECTURE",
      "PROCESSOR_IDENTIFIER",
      "OS",
      "HOMEDRIVE",
      "HOMEPATH",
      "PUBLIC",
      "DRIVERDATA",
    );
  }
  const env = {} as NodeJS.ProcessEnv;
  for (const key of allow) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.PAGER = "cat";
  return env;
}

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin) res.setHeader("access-control-allow-origin", origin);
  else res.setHeader("access-control-allow-origin", "*");
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-private-network", "true");
}

async function requireAuth(req: IncomingMessage, token: string) {
  const header = req.headers.authorization ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!given || !safeEqual(given, token)) {
    throw new BridgeError("unauthenticated", "The local bridge requires a pairing token.");
  }
}

function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function serveProvider(req: IncomingMessage, res: ServerResponse, url: URL, pathname: string) {
  const body = req.method === "GET" || req.method === "HEAD" ? {} : await readBody(req, 16_000_000);
  const result = await handleProviderRequest({
    method: req.method || "GET",
    pathname: pathname.replace(/^\/v1/, "") || "/",
    searchParams: url.searchParams,
    body,
  });
  if (result.kind === "json") {
    sendJson(res, result.status, result.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
  for await (const event of result.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new BridgeError("output_limit", "Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new BridgeError("invalid_params", "Request body must be JSON.");
  }
}

function numberOr(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function statusFor(code: string): number {
  if (code === "unauthenticated") return 401;
  if (code === "forbidden" || code === "dangerous_blocked" || code === "path_escape") return 403;
  if (code === "not_found" || code === "process_not_found") return 404;
  if (code === "invalid_params" || code === "workspace_required") return 400;
  if (code === "already_exists") return 409;
  return 500;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const invoked = process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js");
if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(process.env.KILN_BRIDGE_PORT ?? args.port ?? 3939);
  const host = String(process.env.KILN_BRIDGE_HOST ?? args.host ?? "127.0.0.1");
  const suggested = args["suggested-root"] ? path.resolve(String(args["suggested-root"])) : process.cwd();
  const tokenFile = path.resolve(String(args["token-file"] ?? ".kiln/bridge.json"));
  startBridge({ host, port, suggestedRoot: suggested, tokenFile }).then((bridge) => {
    console.log("");
    console.log("Kiln local execution bridge");
    console.log(`  listening   http://${host}:${bridge.port}`);
    console.log(`  pairing     ${bridge.code}`);
    console.log(`  suggested   ${suggested}`);
    console.log("  workspace   not selected — confirm it in the browser");
    console.log("");
    console.log("The browser never receives unrestricted OS access. This process is the trust boundary.");

    // Graceful shutdown: Ctrl+C or a supervisor signal must not orphan the
    // commands the bridge started (dev servers, watchers, test runs).
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received — stopping the bridge and the commands it started.`);
      bridge.close().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

