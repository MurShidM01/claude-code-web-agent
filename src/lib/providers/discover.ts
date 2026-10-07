import type { ModelInfo } from "@/lib/model/types";
import type { Settings } from "@/lib/persistence/settings";
import { accountKey, type CapabilityFlags, type EndpointStyle, type ModelSource, type ModelSupports, type ResolvedCapabilities } from "@/lib/providers/types";

export interface OpenIdConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  clientId?: string;
  raw: Record<string, unknown>;
}

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata.google.internal."]);

export function isSafeProviderUrl(value: string, allowHttpLocal = false): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host === "169.254.169.254" || host.endsWith(".metadata.internal")) return false;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (url.protocol === "http:") return allowHttpLocal && local;
  return url.protocol === "https:";
}

export async function discoverOpenId(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OpenIdConfig> {
  const root = issuer.replace(/\/$/, "");
  const url = `${root}/.well-known/openid-configuration`;
  if (!isSafeProviderUrl(url)) throw new Error("The identity provider URL is not allowed.");
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not read the identity provider configuration (${response.status}).`);
  const raw = (await response.json()) as Record<string, unknown>;
  const authorizationEndpoint = stringField(raw, "authorization_endpoint");
  const tokenEndpoint = stringField(raw, "token_endpoint");
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error("The identity provider did not publish authorize and token endpoints.");
  }
  return {
    issuer: stringField(raw, "issuer") || root,
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint: stringField(raw, "userinfo_endpoint"),
    deviceAuthorizationEndpoint: stringField(raw, "device_authorization_endpoint"),
    clientId: stringField(raw, "client_id") || stringField(raw, "public_client_id"),
    raw,
  };
}

/** Pull any models-looking URLs out of a discovery document. Does not invent model ids. */
export function modelUrlsFromDiscovery(raw: Record<string, unknown>): string[] {
  const found: string[] = [];
  walk(raw, (value) => {
    if (typeof value === "string" && /^https:\/\//.test(value) && /model/i.test(value) && isSafeProviderUrl(value)) {
      found.push(value);
    }
  });
  return [...new Set(found)];
}

export function modelProbeUrls(baseUrl: string, explicit?: string): string[] {
  if (explicit && isSafeProviderUrl(explicit, true)) return [explicit.replace(/\/$/, "")];
  const root = baseUrl.replace(/\/$/, "");
  const urls = new Set<string>();
  if (/\/models(\?|$)/.test(root)) urls.add(root);
  else {
    urls.add(`${root}/models`);
    if (!/\/v1$/.test(root)) urls.add(`${root}/v1/models`);
  }
  return [...urls].filter((url) => isSafeProviderUrl(url, true));
}

export function joinChatUrl(baseUrl: string, style: Exclude<EndpointStyle, "auto">): string {
  const root = baseUrl.replace(/\/$/, "");
  if (style === "chat-completions") {
    if (/\/chat\/completions$/.test(root)) return root;
    return `${root}/chat/completions`;
  }
  if (style === "messages") {
    if (/\/messages$/.test(root)) return root;
    if (/\/v1$/.test(root)) return `${root}/messages`;
    return `${root}/v1/messages`;
  }
  if (/\/responses$/.test(root)) return root;
  return `${root}/responses`;
}

export function guessEndpoint(baseUrl: string, payload?: unknown): Exclude<EndpointStyle, "auto"> {
  if (/anthropic/i.test(baseUrl)) return "messages";
  if (/\/responses(?:$|\?)/.test(baseUrl)) return "responses";
  const record = asRecord(payload);
  const first = firstModelRecord(payload);
  if (first && (typeof first.slug === "string" || Array.isArray(first.supported_reasoning_levels))) return "responses";
  if (record && Array.isArray(record.data) && record.data.some((item) => asRecord(item)?.type === "model")) {
    if (/anthropic/i.test(baseUrl)) return "messages";
  }
  return "chat-completions";
}

export function modelsFromPayload(
  payload: unknown,
  meta: { provider: string; source: ModelSource; accountId?: string; endpoint?: EndpointStyle },
): ModelInfo[] {
  const records = collectModelRecords(payload);
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const raw of records) {
    const id = stringField(raw, "id") || stringField(raw, "slug") || stringField(raw, "modelId") || stringField(raw, "model") || stringField(raw, "name");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const supports = inferSupports(raw);
    const name = stringField(raw, "display_name") || stringField(raw, "displayName") || stringField(raw, "modelName") || stringField(raw, "name") || id;
    models.push({
      id,
      provider: meta.provider,
      name: name === id ? humanize(id) : name,
      aliases: [],
      contextWindow: supports.contextWindow,
      maxOutputTokens: supports.maxOutputTokens,
      capabilities: capabilityStrings(supports),
      supports,
      source: meta.source,
      accountId: meta.accountId,
      endpoint: meta.endpoint,
    });
  }
  return models;
}

export function inferSupports(raw: Record<string, unknown>): ModelSupports {
  const supports: ModelSupports = {};
  const modalities = collectStrings(raw, ["modalities", "input_modalities", "inputModalities", "supportedInputTypes", "supported_input_types"]);
  const features = collectStrings(raw, ["capabilities", "supported_features", "supportedFeatures", "features"]);
  const blob = [...modalities, ...features].join(" ").toLowerCase();
  if (raw.vision === true || raw.image === true || /image|vision/.test(blob)) supports.vision = true;
  if (raw.vision === false) supports.vision = false;
  if (raw.tools === true || raw.function_calling === true || raw.functionCalling === true || raw.tool_call === true || /tool|function/.test(blob)) {
    supports.tools = true;
  }
  if (raw.tools === false || raw.function_calling === false) supports.tools = false;
  const efforts = reasoningEfforts(raw);
  if (raw.reasoning === true || raw.thinking === true || efforts.length > 0 || /reason|thinking/.test(blob)) supports.reasoning = true;
  if (raw.reasoning === false || raw.thinking === false) supports.reasoning = false;
  if (efforts.length) {
    supports.reasoningEfforts = efforts;
    supports.defaultReasoningEffort = stringField(raw, "default_reasoning_effort") || stringField(raw, "defaultReasoningEffort") || effortName(raw.default_reasoning_level) || efforts[Math.floor(efforts.length / 2)];
  }
  if (raw.streaming === true) supports.streaming = true;
  if (raw.streaming === false) supports.streaming = false;
  const limits = asRecord(raw.tokenLimits) || asRecord(raw.token_limits) || asRecord(raw.limit);
  supports.contextWindow =
    numberField(raw, "context_window") ||
    numberField(raw, "contextWindow") ||
    numberField(raw, "context") ||
    numberField(limits ?? {}, "maxInputTokens") ||
    numberField(limits ?? {}, "context");
  supports.maxOutputTokens =
    numberField(raw, "max_output_tokens") ||
    numberField(raw, "maxOutputTokens") ||
    numberField(raw, "max_tokens") ||
    numberField(limits ?? {}, "maxOutputTokens") ||
    numberField(limits ?? {}, "output");
  return supports;
}

export function capabilityStrings(supports: ModelSupports): string[] {
  const caps: string[] = [];
  if (supports.tools) caps.push("tools");
  if (supports.vision) caps.push("vision");
  if (supports.reasoning) caps.push("reasoning");
  if (supports.streaming) caps.push("streaming");
  if (supports.reasoningEfforts?.length) caps.push(...supports.reasoningEfforts.map((effort) => `reasoning:${effort}`));
  return caps;
}

export function modelAllows(model: ModelInfo | null, settings: Settings, key: keyof CapabilityFlags): boolean {
  const override = overrideFor(model, settings);
  if (override && typeof override[key] === "boolean") return override[key]!;
  const custom = customFor(model, settings);
  if (custom && typeof custom[key] === "boolean") return custom[key];
  const reported = model?.supports?.[key];
  if (typeof reported === "boolean") return reported;
  if (model?.capabilities?.some((cap) => cap === key || cap.startsWith(`${key}:`))) return true;
  // Reasoning and streaming can be requested from the composer icons.
  // Vision stays off until the provider reports it or the user enables that model.
  return key === "streaming" || key === "tools" || key === "reasoning";
}

export function resolveCapabilities(model: ModelInfo | null, settings: Settings): ResolvedCapabilities {
  const effort = model?.supports?.defaultReasoningEffort || model?.supports?.reasoningEfforts?.[0];
  return {
    streaming: settings.streamingEnabled && modelAllows(model, settings, "streaming"),
    reasoning: settings.reasoningEnabled && modelAllows(model, settings, "reasoning"),
    vision: settings.visionEnabled && modelAllows(model, settings, "vision"),
    tools: settings.toolsEnabled && modelAllows(model, settings, "tools"),
    reasoningEffort: effort,
  };
}

export function overrideFor(model: ModelInfo | null, settings: Settings) {
  if (!model) return undefined;
  const key = accountKey(model.accountId, model.id, model.provider);
  return settings.modelOverrides.find((item) => item.key === key);
}

export function customFor(model: ModelInfo | null, settings: Settings) {
  if (!model?.accountId) return undefined;
  return settings.customModels.find((item) => item.providerId === model.accountId && item.id === model.id);
}

function collectModelRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item && modelIdOf(item)));
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["data", "models", "items", "result"]) {
    if (Array.isArray(record[key])) return collectModelRecords(record[key]);
  }
  if (modelIdOf(record)) return [record];
  return [];
}

function firstModelRecord(payload: unknown): Record<string, unknown> | null {
  return collectModelRecords(payload)[0] ?? null;
}

function modelIdOf(raw: Record<string, unknown>): string | undefined {
  return stringField(raw, "id") || stringField(raw, "slug") || stringField(raw, "modelId") || stringField(raw, "model");
}

function reasoningEfforts(raw: Record<string, unknown>): string[] {
  const levels = raw.supported_reasoning_levels || raw.supportedReasoningLevels || raw.reasoning_efforts || raw.reasoningEfforts;
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => (typeof level === "string" ? level : effortName(level)))
    .filter((level): level is string => Boolean(level));
}

function effortName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return stringField(record, "effort") || stringField(record, "name") || stringField(record, "id");
}

function collectStrings(raw: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.push(item);
    }
  }
  return out;
}

function walk(value: unknown, visit: (value: unknown) => void, depth = 0) {
  if (depth > 6) return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visit, depth + 1);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(raw: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = raw?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanize(id: string): string {
  const leaf = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return leaf.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
