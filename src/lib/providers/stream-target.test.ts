import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/persistence/settings";
import type { ModelInfo } from "@/lib/model/types";
import { RoutedModelTransport } from "@/lib/providers/router";
import type { ProviderAccount } from "@/lib/providers/types";

/**
 * The routing rules that decide whether a chat goes to a connected provider
 * account, to Puter, or nowhere. A silent fallback used to send a Codex or
 * Kiro model id to Puter, which turned a broken provider into a blank reply.
 */

function settingsWith(providers: ProviderAccount[]): Settings {
  return { ...DEFAULT_SETTINGS, providers };
}

const codexAccount: ProviderAccount = {
  id: "acct_codex",
  kind: "openai-codex",
  label: "OpenAI · dev@example.com",
  enabled: true,
  createdAt: 1,
  accessToken: "token",
  accountId: "acct-123",
};

function transport(settings: Settings, listModels: () => Promise<ModelInfo[]>) {
  return new RoutedModelTransport(
    () => ({ settings, bridgeStatus: "unavailable", bridgeTransport: "none" }),
    () => undefined,
    {
      name: "puter-stub",
      listModels,
      listProviders: async () => [],
      streamChat: fakePuterStream,
    },
  );
}

async function* fakePuterStream(): AsyncIterable<never> {
  yield { type: "done" } as never;
}

/** Records every /chat POST the router makes so the test can assert the target. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(String(url), init);
  });
  return calls;
}

function sse(...events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("routed model transport", () => {
  it("refuses an unknown model instead of silently calling Puter", async () => {
    const fetchModels = async (): Promise<ModelInfo[]> => [];
    const route = transport(settingsWith([codexAccount]), fetchModels);
    const calls = stubFetch(() => new Response(JSON.stringify({ ok: true, models: [] }), { status: 200, headers: { "content-type": "application/json" } }));

    const pump = async () => {
      for await (const _ of route.streamChat({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        model: "gpt-5-codex",
        provider: "openai-codex",
        signal: new AbortController().signal,
      })) {
        void _;
      }
    };

    await expect(pump()).rejects.toThrow(/cannot reach a provider/i);
    expect(calls.some((call) => call.url.includes("/chat"))).toBe(false);
  });

  it("sends a listed provider model to that account over the API route", async () => {
    const fetchModels = async (): Promise<ModelInfo[]> => [];
    const route = transport(settingsWith([codexAccount]), fetchModels);
    const calls = stubFetch((url) => {
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            ok: true,
            account: codexAccount,
            models: [
              {
                id: "gpt-5-codex",
                provider: "openai-codex",
                name: "GPT-5 Codex",
                aliases: [],
                capabilities: ["streaming", "tools"],
                supports: { streaming: true, tools: true },
                source: "openai-codex",
                accountId: codexAccount.id,
                endpoint: "responses",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return sse({ type: "text", text: "hello from codex" }, { type: "done" });
    });

    await route.listModels();

    const seen: string[] = [];
    for await (const event of route.streamChat({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      model: "gpt-5-codex",
      provider: "openai-codex",
      signal: new AbortController().signal,
    })) {
      if (event.type === "text") seen.push(event.text);
    }

    expect(seen.join("")).toContain("hello from codex");
    const chat = calls.find((call) => call.url.includes("/chat"));
    expect(chat?.url).toBe("/api/provider/chat");
    expect((chat?.body as { account?: { id?: string } })?.account?.id).toBe(codexAccount.id);
  });
});
