import { normalizeCatalog, normalizeModel } from "@/lib/model/catalog";
import { ModelError, type ChatRequest, type ModelInfo, type ModelStreamEvent, type ModelTransport } from "@/lib/model/types";

export interface PuterUser {
  username?: string;
  uuid?: string;
  email?: string;
  feature_flags?: unknown;
}

export interface PuterLike {
  auth: {
    signIn(options?: { attempt_temp_user_creation?: boolean; request_auth?: boolean }): Promise<unknown>;
    signOut(): void;
    isSignedIn(): boolean;
    getUser(): Promise<PuterUser>;
    getProfile?(username?: string): Promise<{ picture?: string; username?: string } | null>;
  };
  ai: {
    chat(messages: unknown, options?: Record<string, unknown>): Promise<unknown>;
    listModels(provider?: string | null): Promise<unknown[]>;
    listModelProviders(): Promise<string[]>;
    normalize?: boolean;
  };
  net?: {
    fetch(url: string, init?: RequestInit): Promise<{ status?: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
  };
}

type PuterModule = { default?: PuterLike } & Partial<PuterLike>;

let loading: Promise<PuterLike> | null = null;

export function getPuterGlobal(): PuterLike | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { puter?: PuterLike }).puter;
  return candidate?.ai && candidate.auth ? candidate : null;
}

export async function loadPuter(): Promise<PuterLike> {
  if (typeof window === "undefined") {
    throw new ModelError("Puter.js can only be initialized in the browser.", "puter_server", false);
  }
  const existing = getPuterGlobal();
  if (existing) return existing;
  if (!loading) {
    loading = (async () => {
      try {
        const imported = (await import("@heyputer/puter.js")) as PuterModule;
        const fromModule = imported.default ?? (imported as unknown as PuterLike);
        if (fromModule?.ai && fromModule.auth) return fromModule;
      } catch {
        // Fall through to the official browser script.
      }
      await injectScript("https://js.puter.com/v2/");
      const globalPuter = getPuterGlobal();
      if (!globalPuter) {
        throw new ModelError("Puter.js loaded but did not expose a client.", "puter_load", true);
      }
      return globalPuter;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("script error")), { once: true });
      if (getPuterGlobal()) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new ModelError("Could not load Puter.js. Check the network and try again.", "puter_load", true));
    document.head.appendChild(script);
  });
}

export type AuthFailureCode = "popup_blocked" | "auth_window_closed" | "unsupported_origin" | "not_available_in_app" | "unknown";

export function classifyAuthError(error: unknown): { code: AuthFailureCode; message: string } {
  const record = error && typeof error === "object" ? (error as { error?: string; msg?: string; message?: string }) : {};
  const code = record.error;
  if (code === "popup_blocked") {
    return {
      code,
      message: "The sign-in popup was blocked. Allow popups for this site, then try again from the button.",
    };
  }
  if (code === "auth_window_closed") {
    return { code, message: "Sign-in was cancelled before it finished. You can try again when you are ready." };
  }
  if (code === "unsupported_origin") {
    return { code, message: record.msg || "This page has no origin Puter can sign in. Open it over http://localhost or a real domain." };
  }
  if (code === "not_available_in_app") {
    return { code, message: record.msg || "This Puter app is already signed in." };
  }
  return { code: "unknown", message: record.msg || record.message || "Sign-in failed. Try again." };
}

export class PuterModelTransport implements ModelTransport {
  readonly name = "puter";

  constructor(private readonly client: () => Promise<PuterLike> = loadPuter) {}

  async listProviders(): Promise<string[]> {
    const puter = await this.client();
    const providers = await puter.ai.listModelProviders();
    return Array.isArray(providers) ? providers.filter((item): item is string => typeof item === "string") : [];
  }

  async listModels(provider?: string): Promise<ModelInfo[]> {
    const puter = await this.client();
    const [models, providers] = await Promise.all([
      puter.ai.listModels(provider),
      provider ? Promise.resolve([provider]) : puter.ai.listModelProviders().catch(() => []),
    ]);
    const catalog = normalizeCatalog(Array.isArray(models) ? models : [], providers);
    return catalog.models;
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ModelStreamEvent> {
    const puter = await this.client();
    const messages = toPuterMessages(request);
    let response: unknown;
    try {
      response = await puter.ai.chat(messages, {
        model: request.model,
        provider: request.provider,
        stream: true,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        normalize: true,
      });
    } catch (error) {
      throw toModelError(error);
    }
    if (request.signal.aborted) return;
    if (isAsyncIterable(response)) {
      for await (const chunk of response) {
        if (request.signal.aborted) return;
        const event = normalizeChunk(chunk);
        if (event) yield event;
      }
      yield { type: "done" };
      return;
    }
    for (const event of normalizeComplete(response)) yield event;
    yield { type: "done" };
  }

  async fetchText(url: string, signal?: AbortSignal): Promise<{ status: number; text: string; contentType?: string }> {
    const puter = await this.client();
    if (!puter.net?.fetch) throw new ModelError("Puter networking is unavailable.", "network", true);
    const response = await puter.net.fetch(url, { signal });
    const text = await response.text();
    return { status: response.status ?? 200, text, contentType: response.headers?.get("content-type") ?? undefined };
  }
}

function toPuterMessages(request: ChatRequest) {
  const messages = request.messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls?.length) {
      return {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
        reasoning_details: message.reasoning_details,
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.tool_call_id, content: message.content ?? "" };
    }
    return { role: message.role, content: message.content ?? "" };
  });
  if (request.images?.length) {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser && typeof lastUser.content === "string") {
      lastUser.content = [
        { type: "text", text: lastUser.content },
        ...request.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
      ] as unknown as string;
    }
  }
  return messages;
}

function normalizeChunk(chunk: unknown): ModelStreamEvent | null {
  if (!chunk || typeof chunk !== "object") return null;
  const record = chunk as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "text" && typeof record.text === "string") return { type: "text", text: record.text };
  if (type === "reasoning" || type === "reasoning_start" || type === "reasoning_detail") return null;
  if (type === "tool_use") {
    return {
      type: "tool_use",
      id: typeof record.id === "string" ? record.id : "",
      name: typeof record.name === "string" ? record.name : "",
      input: record.input ?? {},
    };
  }
  if (type === "tool_use_start") return null;
  if (type === "error") {
    return {
      type: "error",
      message: typeof record.message === "string" ? record.message : "The model stream failed.",
      code: typeof record.code === "string" ? record.code : undefined,
      retryable: /overloaded|rate|timeout|temporar|503|429/i.test(String(record.message ?? record.code ?? "")),
    };
  }
  if (type === "usage") return { type: "usage" };
  if (typeof record.text === "string" && record.text) return { type: "text", text: record.text };
  return null;
}

function normalizeComplete(response: unknown): ModelStreamEvent[] {
  const record = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const message = record.message && typeof record.message === "object" ? (record.message as Record<string, unknown>) : record;
  const events: ModelStreamEvent[] = [];
  const content = message.content;
  if (typeof content === "string" && content) events.push({ type: "text", text: content });
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const part = block as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") events.push({ type: "text", text: part.text });
      if ((part.type === "tool_use" || part.type === "function") && typeof part.name === "string") {
        events.push({ type: "tool_use", id: String(part.id ?? ""), name: part.name, input: part.input ?? {} });
      }
    }
  }
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const call of toolCalls) {
      const item = call as { id?: string; function?: { name?: string; arguments?: string } };
      const args = item.function?.arguments;
      let input: unknown = {};
      if (typeof args === "string") {
        try {
          input = JSON.parse(args);
        } catch {
          input = { _raw: args };
        }
      }
      events.push({
        type: "tool_use",
        id: item.id ?? "",
        name: item.function?.name ?? "",
        input,
      });
    }
  }
  return events;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);
}

function toModelError(error: unknown): ModelError {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "The model request failed.";
  const record = error && typeof error === "object" ? (error as { error?: string; code?: string; status?: number }) : {};
  const retryable = /overloaded|rate|timeout|temporar|503|502|429|network/i.test(`${message} ${record.error ?? ""} ${record.code ?? ""}`);
  return new ModelError(message, record.code || record.error || "model_error", retryable);
}

export async function discoverCatalog(transport: ModelTransport = new PuterModelTransport()) {
  const [models, providers] = await Promise.all([
    transport.listModels(),
    transport.listProviders().catch(() => []),
  ]);
  const normalized = models.map((model) => normalizeModel(model) ?? model).filter((model): model is ModelInfo => Boolean(model?.id));
  return normalizeCatalog(normalized, providers);
}
