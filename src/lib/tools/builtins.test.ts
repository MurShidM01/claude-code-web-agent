import { describe, expect, it } from "vitest";
import { createToolRegistry } from "@/lib/tools/builtins";
import type { ToolContext } from "@/lib/tools/registry";
import { FileSystemAccessWorkspace } from "@/lib/workspace/fsa";
import { MemoryWorkspace } from "@/lib/workspace/memory";
import type { WorkspacePort } from "@/lib/workspace/types";
import { CHROME_NOT_FOUND_MESSAGE, makeFolder } from "@/test/fake-fsa";

function ctxFor(ws: WorkspacePort): ToolContext {
  return {
    signal: new AbortController().signal,
    depth: 0,
    cwd: ws.info()?.root ?? null,
    readState: new Map<string, string>(),
    call: (_operation, fn) => fn(ws),
    onStdout: () => undefined,
    onStderr: () => undefined,
    askUser: async () => null,
    spawnAgent: async () => "",
    loadSkill: () => null,
    outputLimit: 8000,
  };
}

function run(tool: string, input: Record<string, unknown>, ws: WorkspacePort, ctx: ToolContext = ctxFor(ws)) {
  const def = createToolRegistry().get(tool);
  if (!def) throw new Error(`missing tool ${tool}`);
  return def.execute(input, ctx);
}

/** Simulates the pre-fix FSA backend: a missing file is a raw browser DOMException. */
class DomExceptionWorkspace extends MemoryWorkspace {
  override async readFile(path: string, offset?: number, limit?: number) {
    if (!this.files.has(path)) {
      throw new DOMException(CHROME_NOT_FOUND_MESSAGE, "NotFoundError");
    }
    return super.readFile(path, offset, limit);
  }
}

describe("file tools", () => {
  it("Write creates a brand-new file in a folder-picker workspace (regression)", async () => {
    const folder = makeFolder();
    const ws = new FileSystemAccessWorkspace(folder.handle as unknown as FileSystemDirectoryHandle);
    const result = await run("Write", { file_path: "src/new.ts", content: "export {};\n" }, ws);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ type: "create" });
    expect(folder.read("src/new.ts")).toBe("export {};\n");
  });

  it("Write succeeds when the backend reports a missing file as a raw DOMException (regression)", async () => {
    const ws = new DomExceptionWorkspace("/workspace");
    const result = await run("Write", { file_path: "fresh.ts", content: "hi\n" }, ws);
    expect(result.ok).toBe(true);
    expect(ws.files.get("fresh.ts")?.content).toBe("hi\n");
  });

  it("Write requires a read before overwriting an existing file", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("a.txt", "old\n");
    const result = await run("Write", { file_path: "a.txt", content: "new\n" }, ws);
    expect(result.ok).toBe(false);
    expect(result.output).toMatchObject({ code: "read_required" });
    expect(ws.files.get("a.txt")?.content).toBe("old\n");
  });

  it("Write after a Read overwrites and returns a diff", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("a.txt", "old\n");
    const ctx = ctxFor(ws);
    await run("Read", { file_path: "a.txt" }, ws, ctx);
    const result = await run("Write", { file_path: "a.txt", content: "new\n" }, ws, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ type: "update" });
    expect(result.diff?.original).toBe("old\n");
    expect(result.diff?.next).toBe("new\n");
    expect(ws.files.get("a.txt")?.content).toBe("new\n");
  });

  it("Edit on a missing file surfaces a typed not_found error", async () => {
    const ws = new MemoryWorkspace("/workspace");
    await expect(run("Edit", { file_path: "missing.ts", old_string: "a", new_string: "b" }, ws)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("MultiEdit applies every edit in one pass", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("m.ts", "const a = 1;\nconst b = 2;\n");
    const ctx = ctxFor(ws);
    await run("Read", { file_path: "m.ts" }, ws, ctx);
    const result = await run(
      "MultiEdit",
      {
        file_path: "m.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 10;" },
          { old_string: "const b = 2;", new_string: "const b = 20;" },
        ],
      },
      ws,
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ edits: 2, replacements: 2 });
    expect(ws.files.get("m.ts")?.content).toBe("const a = 10;\nconst b = 20;\n");
  });

  it("MultiEdit writes nothing when any edit fails", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("m.ts", "const a = 1;\n");
    const ctx = ctxFor(ws);
    await run("Read", { file_path: "m.ts" }, ws, ctx);
    const result = await run(
      "MultiEdit",
      {
        file_path: "m.ts",
        edits: [
          { old_string: "const a = 1;", new_string: "const a = 10;" },
          { old_string: "not there", new_string: "x" },
        ],
      },
      ws,
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatchObject({ code: "edit_failed" });
    expect(ws.files.get("m.ts")?.content).toBe("const a = 1;\n");
  });

  it("MultiEdit requires a prior read", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("m.ts", "const a = 1;\n");
    const result = await run("MultiEdit", { file_path: "m.ts", edits: [{ old_string: "a", new_string: "b" }] }, ws);
    expect(result.ok).toBe(false);
    expect(result.output).toMatchObject({ code: "read_required" });
  });

  it("Stat returns metadata and reports missing paths with a typed error", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("a.txt", "abc\n");
    const result = await run("Stat", { file_path: "a.txt" }, ws);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ kind: "file", size: 4 });
    await expect(run("Stat", { file_path: "missing" }, ws)).rejects.toMatchObject({ code: "not_found" });
  });

  it("BashOutput reads the status of a background command", async () => {
    const ws = new MemoryWorkspace("/workspace");
    const command = await ws.runCommand({ command: "echo hi" });
    const result = await run("BashOutput", { task_id: command.processId }, ws);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ running: false, exitCode: 127 });
  });

  it("Delete removes a file and reports missing paths as not_found", async () => {
    const ws = new MemoryWorkspace("/workspace");
    ws.seed("a.txt", "x\n");
    const result = await run("Delete", { path: "a.txt" }, ws);
    expect(result.ok).toBe(true);
    expect(ws.files.has("a.txt")).toBe(false);
    await expect(run("Delete", { path: "a.txt" }, ws)).rejects.toMatchObject({ code: "not_found" });
  });
});
