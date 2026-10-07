import { describe, expect, it } from "vitest";
import { FileSystemAccessWorkspace } from "@/lib/workspace/fsa";
import { makeFolder, makeFsOptions, type FakeFolder } from "@/test/fake-fsa";

function workspaceFor(folder: FakeFolder) {
  return new FileSystemAccessWorkspace(folder.handle as unknown as FileSystemDirectoryHandle);
}

describe("FileSystemAccessWorkspace", () => {
  it("reads and writes files, creating parent directories", async () => {
    const folder = makeFolder({ "src/app.ts": "export {};\n" });
    const ws = workspaceFor(folder);
    expect((await ws.readFile("src/app.ts")).content).toBe("export {};\n");

    const written = await ws.writeFile("src/deep/nested/new.ts", "hello\n");
    expect(written.created).toBe(true);
    expect(folder.read("src/deep/nested/new.ts")).toBe("hello\n");

    const overwritten = await ws.writeFile("src/deep/nested/new.ts", "bye\n");
    expect(overwritten.created).toBe(false);
    expect(folder.read("src/deep/nested/new.ts")).toBe("bye\n");
  });

  it("reports a missing file as a typed not_found error, not a raw DOMException", async () => {
    const ws = workspaceFor(makeFolder());
    const error = await ws.readFile("nope.ts").catch((err: unknown) => err);
    expect(error).toMatchObject({ name: "BridgeError", code: "not_found" });
    expect((error as Error).message).toContain("No such file");
    expect((error as Error).message).not.toContain("could not be found at the time");
  });

  it("refuses to write over a directory with a typed error", async () => {
    const folder = makeFolder({ "src/keep.ts": "x\n" });
    const ws = workspaceFor(folder);
    await expect(ws.writeFile("src", "nope")).rejects.toMatchObject({ code: "not_a_file" });
    expect(folder.read("src/keep.ts")).toBe("x\n");
  });

  it("deletes files and reports missing paths as not_found", async () => {
    const folder = makeFolder({ "a.txt": "1\n", "b.txt": "2\n" });
    const ws = workspaceFor(folder);
    await ws.deleteFile("a.txt");
    expect(folder.read("a.txt")).toBeNull();
    await expect(ws.deleteFile("a.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("moves files without corrupting binary content", async () => {
    const binary = "a\u0000b\u0000c";
    const folder = makeFolder({ "bin.dat": binary });
    const ws = workspaceFor(folder);
    await ws.renamePath("bin.dat", "moved/bin.dat");
    expect(folder.read("bin.dat")).toBeNull();
    expect(folder.read("moved/bin.dat")).toBe(binary);
  });

  it("moves whole directory trees recursively", async () => {
    const folder = makeFolder({ "old/a.txt": "1\n", "old/sub/b.txt": "2\n" });
    const ws = workspaceFor(folder);
    await ws.renamePath("old", "new");
    expect(folder.paths()).toEqual(["new", "new/a.txt", "new/sub", "new/sub/b.txt"]);
    expect(folder.read("new/sub/b.txt")).toBe("2\n");
  });

  it("refuses to overwrite an existing destination unless asked", async () => {
    const folder = makeFolder({ "from.txt": "1\n", "to.txt": "2\n" });
    const ws = workspaceFor(folder);
    await expect(ws.renamePath("from.txt", "to.txt")).rejects.toMatchObject({ code: "already_exists" });
    await ws.renamePath("from.txt", "to.txt", true);
    expect(folder.read("to.txt")).toBe("1\n");
    expect(folder.read("from.txt")).toBeNull();
  });

  it("reports metadata for files and directories, and not_found for missing paths", async () => {
    const folder = makeFolder({ "src/app.ts": "abc\n" });
    const ws = workspaceFor(folder);
    expect(await ws.getFileMetadata("src/app.ts")).toMatchObject({ kind: "file", size: 4 });
    expect(await ws.getFileMetadata("src")).toMatchObject({ kind: "directory" });
    await expect(ws.getFileMetadata("missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists directories and reports missing directories as not_found", async () => {
    const folder = makeFolder({ "src/app.ts": "x\n" });
    const ws = workspaceFor(folder);
    const tree = await ws.listDirectory(".", 2);
    expect(tree.children?.map((child) => child.name)).toEqual(["src"]);
    await expect(ws.listDirectory("missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("searches file contents", async () => {
    const folder = makeFolder({ "a.ts": "const needle = 1;\n", "b.ts": "nothing\n" });
    const ws = workspaceFor(folder);
    const result = await ws.searchFiles({ query: "needle" });
    expect(result.matches).toEqual([{ path: "a.ts", line: 1, text: "const needle = 1;" }]);
  });

  it("rejects paths that escape the picked folder", async () => {
    const ws = workspaceFor(makeFolder());
    await expect(ws.readFile("../outside.txt")).rejects.toMatchObject({ code: "path_escape" });
    await expect(ws.writeFile("../outside.txt", "x")).rejects.toMatchObject({ code: "path_escape" });
  });

  it("asks for write permission again when the browser revoked it, then retries", async () => {
    const options = makeFsOptions(1); // the first create attempt is denied
    const folder = makeFolder({}, options);
    const ws = workspaceFor(folder);
    const written = await ws.writeFile("src/recovered.ts", "back\n");
    expect(written.created).toBe(true);
    expect(folder.read("src/recovered.ts")).toBe("back\n");
  });

  it("creates directories with mkdir", async () => {
    const folder = makeFolder();
    const ws = workspaceFor(folder);
    await ws.mkdir("a/b/c");
    const tree = await ws.listDirectory(".", 3);
    expect(JSON.stringify(tree)).toContain("c");
  });
});
