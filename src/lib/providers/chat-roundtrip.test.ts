import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { startBridge } from "../../../bridge/src/server";
import { AppController } from "@/lib/app/controller";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/persistence/settings";
import { MemoryPersistence } from "@/lib/persistence/db";
import { RoutedModelTransport } from "@/lib/providers/router";
import type { ProviderAccount } from "@/lib/providers/types";
import { BridgeClient, directTransport } from "@/lib/workspace/bridge-client";

/**
 * The path a bridged browser actually takes:
 * controller → RoutedModelTransport → bridge provider route → upstream SSE.
 *
 * The upstream is a real HTTP server that speaks the OpenAI chat-completions
 * wire format, so this covers request shaping, the SSE decoder, and the way
 * the controller projects events into transcript blocks.
 */

const closers: (() => Promise<void> | void)[] = [];
const cleanup: string[] = [];

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
});

// Each test rewrites the global fetch. Leaving a stub in place would make the
// next test's "real fetch" reference the previous stub.
afterEach(() => vi.unstubAllGlobals());

function upstream(
  script: (write: (event: string) => void, finish: () => void) => void,
  modelId = "demo-model",
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // The catalog is discovered from the provider, exactly like production.
      if ((req.url ?? "").includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: modelId,
                name: "Demo Model",
                context_window: 128000,
                capabilities: ["tools", "streaming"],
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      script(
        (event) => res.write(event),
        () => res.end(),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      closers.push(() => new Promise<void>((done) => server.close(() => done())));
      resolve({ server, port });
    });
  });
}

function account(baseUrl: string): ProviderAccount {
  return {
    id: "acct_demo",
    kind: "custom",
    label: "Demo",
    enabled: true,
    createdAt: 1,
    baseUrl,
    apiKey: "sk-demo",
    endpoint: "chat-completions",
    detectedEndpoint: "chat-completions",
  };
}

function settings(providers: ProviderAccount[]): Settings {
  return { ...DEFAULT_SETTINGS, providers };
}

/**
 * Stand in for the Next.js `/api/bridge/[...path]` proxy: it forwards the
 * browser's request to the bridge with the pairing token, exactly as the
 * route handler does. That keeps the test on the real production path
 * (proxy transport) instead of a test-only shortcut.
 */
function proxyToBridge(bridgePort: number, token: string) {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/bridge/")) {
      const path = url.slice("/api/bridge".length);
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return real(`http://127.0.0.1:${bridgePort}/v1${path}`, { ...init, headers });
    }
    if (url.startsWith("/api/provider/")) {
      throw new Error(`unexpected provider route: ${url}`);
    }
    return real(input as RequestInfo, init);
  });
}

async function bridged(
  providers: ProviderAccount[],
  bridge: { port: number; token: string },
  client: BridgeClient,
) {
  proxyToBridge(bridge.port, bridge.token);
  const router = new RoutedModelTransport(
    () => ({ settings: settings(providers), bridgeStatus: "connected", bridgeTransport: "proxy" }),
    () => undefined,
    { name: "puter-stub", listModels: async () => [], listProviders: async () => [], streamChat: async function* () {} },
  );
  const controller = new AppController({ persistence: new MemoryPersistence(), model: router, bridge: client });
  await controller.bootstrap();
  return controller;
}

describe("bridged chat round trip", () => {
  it("streams a real provider reply into transcript blocks", async () => {
    const { port } = await upstream((write, finish) => {
      write(`data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n`);
      write(`data: {"choices":[{"delta":{"content":"from the provider."}}]}\n\n`);
      write(`data: {"choices":[{"finish_reason":"stop"}]}\n\n`);
      write(`data: [DONE]\n\n`);
      finish();
    });

    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-chat-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    const controller = await bridged([account(`http://127.0.0.1:${port}/v1`)], bridge, client);
    await controller.selectBridgeWorkspace(root);
    await controller.send("say hello");

    const blocks = controller.blocks();
    const assistant = blocks.filter((block) => block.kind === "assistant").map((block) => (block as { text: string }).text);
    expect(assistant.join("")).toContain("Hello from the provider.");
    const snapshot = controller.getSnapshot();
    expect(snapshot.running).toBe(false);
    expect(snapshot.phase).toBe("finished");
    // No error blocks: the round trip was clean.
    expect(blocks.some((block) => block.kind === "error")).toBe(false);
  });

  it("reports an upstream error instead of ending quietly", async () => {
    const { port } = await upstream((write, finish) => {
      write(`data: {"error":{"message":"model is overloaded","code":"overloaded"}}\n\n`);
      finish();
    });

    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-err-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    const controller = await bridged([account(`http://127.0.0.1:${port}/v1`)], bridge, client);
    await controller.selectBridgeWorkspace(root);
    await controller.send("this will fail");

    const blocks = controller.blocks();
    const text = blocks
      .map((block) => {
        if (block.kind === "assistant") return block.text;
        if (block.kind === "error") return block.message;
        return "";
      })
      .join(" ");
    expect(text).toMatch(/overloaded|failed|error/i);
    expect(controller.getSnapshot().running).toBe(false);
  });

  it("tells the user when the upstream returns an empty stream", async () => {
    const { port } = await upstream((write, finish) => {
      write(`data: {"choices":[{"finish_reason":"stop"}]}\n\n`);
      write(`data: [DONE]\n\n`);
      finish();
    });

    const root = await mkdtemp(path.join(tmpdir(), "kiln-bridge-empty-"));
    cleanup.push(root);
    const bridge = await startBridge({ host: "127.0.0.1", port: 0, suggestedRoot: root, tokenFile: null });
    closers.push(bridge.close);
    const client = new BridgeClient(directTransport("127.0.0.1", bridge.port, bridge.token));
    await client.selectWorkspace(root);

    const controller = await bridged([account(`http://127.0.0.1:${port}/v1`)], bridge, client);
    await controller.selectBridgeWorkspace(root);
    await controller.send("say nothing");

    const assistant = controller
      .blocks()
      .filter((block) => block.kind === "assistant")
      .map((block) => (block as { text: string }).text)
      .join(" ");
    expect(assistant).toMatch(/empty reply/i);
  });
});
