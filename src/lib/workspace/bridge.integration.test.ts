import { mkdtemp, readFile, rm } from "node:fs/promises";
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
});
