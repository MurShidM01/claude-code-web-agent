import { describe, expect, it } from "vitest";
import { normalizeSettings } from "@/lib/persistence/settings";
import { buildCodexAuthorizeUrl, callbackParts, CODEX_PUBLIC_CLIENT_ID } from "@/lib/providers/auth";
import { inferSupports, isSafeProviderUrl, modelAllows, modelsFromPayload, resolveCapabilities } from "@/lib/providers/discover";
import { StreamDecoder } from "@/lib/providers/formats";
import type { ModelInfo } from "@/lib/model/types";

describe("provider discovery", () => {
  it("reads models from live payload shapes and does not invent any", () => {
    const openai = modelsFromPayload({ data: [{ id: "gpt-test", owned_by: "openai" }] }, { provider: "custom", source: "custom", accountId: "a1" });
    const codex = modelsFromPayload({ models: [{ slug: "gpt-live", display_name: "GPT Live", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }], input_modalities: ["text", "image"] }] }, { provider: "openai-codex", source: "openai-codex" });
    const kiro = modelsFromPayload({ models: [{ modelId: "claude-from-api", modelName: "Claude From API", supportedInputTypes: ["TEXT", "IMAGE"], tokenLimits: { maxInputTokens: 200000 } }] }, { provider: "kiro", source: "kiro" });
    expect(openai.map((model) => model.id)).toEqual(["gpt-test"]);
    expect(codex[0]).toMatchObject({ id: "gpt-live", name: "GPT Live" });
    expect(codex[0]?.supports?.reasoning).toBe(true);
    expect(codex[0]?.supports?.vision).toBe(true);
    expect(codex[0]?.supports?.reasoningEfforts).toEqual(["low", "high"]);
    expect(kiro[0]).toMatchObject({ id: "claude-from-api", contextWindow: 200000 });
    expect(modelsFromPayload({ models: [] }, { provider: "x", source: "custom" })).toEqual([]);
    expect(modelsFromPayload({ nope: true }, { provider: "x", source: "custom" })).toEqual([]);
  });

  it("infers capabilities only from fields the provider sent", () => {
    expect(inferSupports({ id: "mystery-model" }).vision).toBeUndefined();
    expect(inferSupports({ id: "mystery-model" }).tools).toBeUndefined();
    expect(inferSupports({ id: "mystery-model" }).reasoning).toBeUndefined();
    expect(inferSupports({ id: "seen", vision: true, tools: false, streaming: false }).vision).toBe(true);
    expect(inferSupports({ id: "seen", tools: false }).tools).toBe(false);
  });

  it("lets a model toggle override a live report, and keeps vision off when unreported", () => {
    const model: ModelInfo = {
      id: "m",
      provider: "custom",
      name: "M",
      aliases: [],
      capabilities: [],
      supports: { reasoning: false, tools: true },
      accountId: "acct",
    };
    const settings = normalizeSettings({
      modelOverrides: [{ key: "acct::m", reasoning: true }],
    });
    expect(modelAllows(model, settings, "reasoning")).toBe(true);
    expect(modelAllows(model, settings, "vision")).toBe(false);
    expect(resolveCapabilities(model, settings).reasoning).toBe(true);
    expect(resolveCapabilities(model, { ...settings, reasoningEnabled: false }).reasoning).toBe(false);
  });

  it("rejects metadata hosts and accepts a local custom base URL", () => {
    expect(isSafeProviderUrl("http://169.254.169.254/latest")).toBe(false);
    expect(isSafeProviderUrl("http://127.0.0.1:11434/v1", true)).toBe(true);
    expect(isSafeProviderUrl("http://example.com/v1", true)).toBe(false);
  });

  it("builds the OpenAI account-chooser URL from discovered endpoints", () => {
    const url = new URL(buildCodexAuthorizeUrl({
      authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
      clientId: CODEX_PUBLIC_CLIENT_ID,
      redirectUri: "http://localhost:1455/auth/callback",
      challenge: "abc",
      state: "state-1",
    }));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(callbackParts(`${url.origin}/auth/callback?code=c&state=state-1`)).toEqual({ code: "c", state: "state-1", error: undefined });
  });

  it("normalizes older saved settings without dropping theme", () => {
    const settings = normalizeSettings({ theme: "dark", extraDenyPatterns: ["rm -rf /"] });
    expect(settings.theme).toBe("dark");
    expect(settings.extraDenyPatterns).toEqual(["rm -rf /"]);
    expect(settings.providers).toEqual([]);
    expect(settings.reasoningEnabled).toBe(true);
    expect(settings.streamingEnabled).toBe(true);
  });
});

describe("provider streams", () => {
  it("assembles chat-completions tool calls across deltas", () => {
    const decoder = new StreamDecoder("chat-completions");
    const first = decoder.push('data: {"choices":[{"delta":{"content":"Hi","tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read","arguments":""}}]}}]}\n\n');
    const second = decoder.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file_path\\":\\"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
    const events = [...first, ...second];
    expect(events.some((event) => event.type === "text" && event.text === "Hi")).toBe(true);
    expect(events.find((event) => event.type === "tool_use")).toMatchObject({ name: "Read", id: "call_1" });
  });

  it("reads a responses function call and an anthropic thinking delta", () => {
    const responses = new StreamDecoder("responses");
    const events = responses.push('event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"LS","arguments":"{}"}}\n\n');
    expect(events.find((event) => event.type === "tool_use")).toMatchObject({ name: "LS", id: "c1" });
    const anthropic = new StreamDecoder("messages");
    const thought = anthropic.push('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"look"}}\n\n');
    expect(thought).toEqual([{ type: "reasoning", text: "look" }]);
  });

  it("parses a complete Kiro assistant payload", () => {
    const decoder = new StreamDecoder("kiro");
    const events = decoder.finish(JSON.stringify({
      assistantResponseMessage: { content: "Done.", toolUses: [{ toolUseId: "t1", name: "Read", input: { file_path: "a.ts" } }] },
    }));
    expect(events.find((event) => event.type === "text")).toMatchObject({ text: "Done." });
    expect(events.find((event) => event.type === "tool_use")).toMatchObject({ name: "Read", id: "t1" });
  });
});
