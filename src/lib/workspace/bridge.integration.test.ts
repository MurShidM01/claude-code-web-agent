import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startBridge } from "../../../bridge/src/server";
import { BridgeClient, directTransport } from "@/lib/workspace/bridge-client";

const roots: string[] = [];
let close: (() => Promise<void>) | null = null;

afterAll(async () => {
  await close?.();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("local execution bridge", () => {
  it("rejects an unpaired client, then edits a file and runs a command inside the root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-"));
    roots.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    close = bridge.close;
    const anonymous = new BridgeClient(directTransport("127.0.0.1", bridge.port, "nope"));
    await expect(anonymous.health()).rejects.toMatchObject({ code: "unauthenticated" });

    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);
    await client.writeFile("src/hello.txt", "hello\n");
    const read = await client.readFile("src/hello.txt");
    expect(read.content).toContain("hello");
    await expect(client.readFile("../outside.txt")).rejects.toMatchObject({ code: "path_escape" });

    const chunks: string[] = [];
    const result = await client.runCommand({ command: "node -e \"console.log('ran')\"", timeoutMs: 10_000 }, (event) => {
      if (event.type === "stdout" && event.data) chunks.push(event.data);
    });
    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toContain("ran");
    expect(await readFile(path.join(root, "src/hello.txt"), "utf8")).toBe("hello\n");
  });

  it("writes files atomically: creates parents, tracks created, leaves no temp files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-write-"));
    roots.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, tokenFile: null });
    close = bridge.close;
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    const created = await client.writeFile("a/b/c.txt", "one\n");
    expect(created).toMatchObject({ created: true, path: "a/b/c.txt" });
    expect(await readFile(path.join(root, "a/b/c.txt"), "utf8")).toBe("one\n");

    const overwritten = await client.writeFile("a/b/c.txt", "two\n");
    expect(overwritten).toMatchObject({ created: false });
    expect(await readFile(path.join(root, "a/b/c.txt"), "utf8")).toBe("two\n");

    // The atomic write must not leave staging files behind.
    const leftovers: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.includes(".kiln-") && entry.name.endsWith(".tmp")) leftovers.push(entry.name);
        if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      }
    };
    await walk(root);
    expect(leftovers).toEqual([]);
  });

  it("reports missing paths with typed not_found errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-missing-"));
    roots.push(root);
    await writeFile(path.join(root, "real.txt"), "x\n", "utf8");
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, tokenFile: null });
    close = bridge.close;
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    await expect(client.readFile("missing.txt")).rejects.toMatchObject({ code: "not_found" });
    await expect(client.deleteFile("missing.txt")).rejects.toMatchObject({ code: "not_found" });
    await expect(client.getFileMetadata("missing.txt")).rejects.toMatchObject({ code: "not_found" });
    await expect(client.listDirectory("missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(client.renamePath("missing.txt", "other.txt")).rejects.toMatchObject({ code: "not_found" });
    expect(await client.getFileMetadata("real.txt")).toMatchObject({ kind: "file", size: 2 });
  });

  it("renames and deletes inside the root, and refuses to escape it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-move-"));
    roots.push(root);
    await writeFile(path.join(root, "old.txt"), "data\n", "utf8");
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, tokenFile: null });
    close = bridge.close;
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    await client.renamePath("old.txt", "dir/new.txt");
    expect(await readFile(path.join(root, "dir/new.txt"), "utf8")).toBe("data\n");
    await expect(client.renamePath("dir/new.txt", "../escape.txt")).rejects.toMatchObject({ code: "path_escape" });

    await client.deleteFile("dir/new.txt");
    await expect(client.readFile("dir/new.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("searches file contents and skips missing directories with not_found", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-search-"));
    roots.push(root);
    await writeFile(path.join(root, "hit.ts"), "const needle = 42;\n", "utf8");
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, tokenFile: null });
    close = bridge.close;
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    const result = await client.searchFiles({ query: "needle" });
    expect(result.matches).toEqual([{ path: "hit.ts", line: 1, text: "const needle = 42;" }]);
    await expect(client.searchFiles({ query: "x", path: "missing" })).rejects.toMatchObject({ code: "not_found" });
  });
});
