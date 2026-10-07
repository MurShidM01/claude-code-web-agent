import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startBridge } from "../../../bridge/src/server";
import { AppController } from "@/lib/app/controller";
import { ScriptedModel } from "@/lib/model/scripted";
import { PuterModelTransport, classifyAuthError } from "@/lib/model/puter";
import { MemoryPersistence } from "@/lib/persistence/db";
import { BridgeClient, directTransport } from "@/lib/workspace/bridge-client";

const cleanup: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("end-to-end agent flows", () => {
  it("loads models, connects a workspace, streams a turn, edits a file, and runs a command", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-e2e-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);
    const model = new ScriptedModel([
      {
        text: "Creating the note.",
        tools: [{ name: "Write", input: { file_path: "notes.txt", content: "kiln\n" } }],
      },
      { tools: [{ name: "Bash", input: { command: "cat notes.txt", description: "Show the note" } }] },
      { text: "Wrote notes.txt and confirmed it." },
    ]);
    const persistence = new MemoryPersistence();
    const app = new AppController({ persistence, model, bridge: client });
    await app.bootstrap();
    expect(app.getSnapshot().models.status).toBe("ready");
    expect(app.getSnapshot().models.catalog?.models.map((item) => item.id)).toContain("scripted-1");
    expect(app.getSnapshot().bridge.status).toBe("connected");
    app.selectModel("scripted-1", "scripted");
    app.setPermissionMode("full");
    await app.selectBridgeWorkspace(root);
    await app.send("create a note and show it");
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("kiln\n");
    const blocks = app.blocks();
    expect(blocks.some((block) => block.kind === "assistant" && block.text.includes("confirmed"))).toBe(true);
    expect(blocks.some((block) => block.kind === "tool" && block.name === "Bash" && block.status === "done")).toBe(true);
    expect(blocks.some((block) => block.kind === "diff")).toBe(true);
    app.setTheme("dark");
    expect((await persistence.loadSettings()).theme).toBe("dark");
  });

  it("asks before a write, honors allow and deny, and can be cancelled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-e2e-perm-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    const model = new ScriptedModel([
      { tools: [{ name: "Write", input: { file_path: "allowed.txt", content: "yes\n" } }] },
      { text: "The write was allowed." },
      { tools: [{ name: "Write", input: { file_path: "denied.txt", content: "no\n" } }] },
      { text: "The write was denied, so I stopped." },
      { tools: [{ name: "Bash", input: { command: "sleep 30", description: "Wait" } }] },
      { text: "This should not be reached." },
    ]);
    const app = new AppController({ persistence: new MemoryPersistence(), model, bridge: client });
    await app.bootstrap();
    app.selectModel("scripted-1", "scripted");
    app.setPermissionMode("ask");
    await app.selectBridgeWorkspace(root);

    const allowed = app.send("write allowed");
    await waitFor(app, () => Boolean(app.getSnapshot().permission));
    expect(app.getSnapshot().permission?.command ?? app.getSnapshot().permission?.paths.join(",")).toContain("allowed.txt");
    app.decidePermission(true, false);
    await allowed;
    expect(await readFile(path.join(root, "allowed.txt"), "utf8")).toBe("yes\n");

    const denied = app.send("write denied");
    await waitFor(app, () => Boolean(app.getSnapshot().permission));
    app.decidePermission(false, true);
    await denied;
    await expect(readFile(path.join(root, "denied.txt"), "utf8")).rejects.toThrow();
    expect(app.blocks().some((block) => block.kind === "assistant" && /denied/i.test(block.text))).toBe(true);

    const hanging = app.send("wait");
    await waitFor(app, () => Boolean(app.getSnapshot().permission));
    app.cancel();
    await hanging;
    expect(app.getSnapshot().phase).toBe("cancelled");
  });

  it("refuses to send through Puter until the user signs in, and classifies auth failures", async () => {
    const app = new AppController({ persistence: new MemoryPersistence(), model: new PuterModelTransport() });
    await app.send("hello");
    expect(app.getSnapshot().authDialog?.title).toMatch(/Sign in/);
    expect(classifyAuthError({ error: "popup_blocked" }).message).toMatch(/popup/i);
    expect(classifyAuthError({ error: "auth_window_closed" }).message).toMatch(/cancelled/i);
  });
});

function waitFor(app: AppController, predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Timed out waiting for the UI state."));
    }, timeoutMs);
    const stop = app.subscribe(() => {
      if (!predicate()) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}
