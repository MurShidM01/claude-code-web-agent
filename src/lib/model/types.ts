export interface ModelCost {
  currency: string;
  perTokens: number;
  input?: number;
  output?: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  aliases: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  cost?: ModelCost;
  capabilities: string[];
  releasedAt?: string;
  /** Filled by a live provider response. Never assumed from the model id. */
  supports?: {
    streaming?: boolean;
    reasoning?: boolean;
    vision?: boolean;
    tools?: boolean;
    reasoningEfforts?: string[];
    defaultReasoningEffort?: string;
    contextWindow?: number;
    maxOutputTokens?: number;
  };
  source?: "puter" | "openai-codex" | "kiro" | "custom";
  accountId?: string;
  endpoint?: "auto" | "chat-completions" | "messages" | "responses";
}

export interface ModelCatalog {
  models: ModelInfo[];
  providers: string[];
  loadedAt: number;
}

export interface ModelToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  reasoning_details?: unknown;
}

export type ModelStreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "error"; message: string; code?: string; retryable?: boolean }
  | { type: "done"; finishReason?: string };

export interface ChatRequest {
  messages: ModelMessage[];
  tools: ModelToolSpec[];
  model: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
  images?: { mediaType: string; dataUrl: string }[];
  stream?: boolean;
  reasoning?: boolean;
  reasoningEffort?: string;
  source?: "puter" | "openai-codex" | "kiro" | "custom";
  accountId?: string;
  endpoint?: "auto" | "chat-completions" | "messages" | "responses";
}

export interface ModelTransport {
  readonly name: string;
  listProviders(): Promise<string[]>;
  listModels(provider?: string): Promise<ModelInfo[]>;
  streamChat(request: ChatRequest): AsyncIterable<ModelStreamEvent>;
  fetchText?(url: string, signal?: AbortSignal): Promise<{ status: number; text: string; contentType?: string }>;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly code = "model_error",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ModelError";
  }
}
