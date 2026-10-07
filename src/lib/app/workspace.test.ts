import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startBridge } from "../../../bridge/src/server";
import { AppController } from "@/lib/app/controller";
import { ScriptedModel } from "@/lib/model/scripted";
import { MemoryPersistence } from "@/lib/persistence/db";
import { BridgeClient, directTransport } from "@/lib/workspace/bridge-client";

const cleanup: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
});

function model() {
  return new ScriptedModel([{ text: "ok" }]);
}

function controllerFor(client: BridgeClient, persistence = new MemoryPersistence()) {
  return new AppController({ persistence, model: model(), bridge: client });
}

describe("opening a project", () => {
  it("connects a path, lists it as recent, and remembers it across reloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-open-"));
    cleanup.push(root);
    await writeFile(path.join(root, "app.js"), "module.exports = 1;\n", "utf8");
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);

    const persistence = new MemoryPersistence();
    const app = controllerFor(new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token)), persistence);
    await app.bootstrap();
    expect(app.getSnapshot().workspace.kind).toBe("none");
    expect(app.getSnapshot().workspaces).toEqual([]);

    await app.selectBridgeWorkspace(root);
    const state = app.getSnapshot();
    expect(state.workspace.kind).toBe("bridge");
    expect(state.workspace.root).toBe(root);
    expect(state.workspace.label).toBe(path.basename(root));
    expect(state.workspaces.map((entry) => entry.root)).toContain(root);
    expect(await persistence.listWorkspaces()).toHaveLength(1);

    // The connected project can actually be read through the workspace port.
    const entries = await app.listRoot();
    expect(entries.map((entry) => entry.name)).toContain("app.js");

    // A page reload against the same bridge adopts the project the bridge already has open.
    const reloaded = controllerFor(new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token)), persistence);
    await reloaded.bootstrap();
    expect(reloaded.getSnapshot().workspace.kind).toBe("bridge");
    expect(reloaded.getSnapshot().workspace.root).toBe(root);
    expect(reloaded.workspacePort().info()?.root).toBe(root);
    expect((await reloaded.listRoot()).map((entry) => entry.name)).toContain("app.js");

    // Closing drops the tools; reopening from recents restores them.
    reloaded.closeWorkspace();
    expect(reloaded.getSnapshot().workspace.kind).toBe("none");
    expect(reloaded.workspacePort().info()).toBeNull();

    const recent = reloaded.getSnapshot().workspaces[0]!;
    await reloaded.openWorkspace(recent.id);
    expect(reloaded.getSnapshot().workspace.kind).toBe("bridge");
    expect((await reloaded.listRoot()).map((entry) => entry.name)).toContain("app.js");
  });

  it("keeps recent projects when persistence is unavailable and refuses an unknown id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-open-broken-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);

    const failing = new MemoryPersistence();
    failing.listWorkspaces = async () => {
      throw new Error("IndexedDB blocked");
    };
    const app = controllerFor(new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token)), failing);
    await app.bootstrap();
    await app.selectBridgeWorkspace(root);
    expect(app.getSnapshot().workspaces.map((entry) => entry.root)).toContain(root);

    await app.openWorkspace("bridge:/does/not/exist");
    expect(app.getSnapshot().notice?.title).toMatch(/no longer listed/i);
  });

  it("adopts nothing when the bridge has no project selected", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kiln-open-empty-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: null, tokenFile: null });
    closers.push(bridge.close);
    const app = controllerFor(new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token)));
    await app.bootstrap();
    expect(app.getSnapshot().bridge.status).toBe("connected");
    expect(app.getSnapshot().workspace.kind).toBe("none");
  });
});
