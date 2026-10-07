/** How a custom or discovered endpoint expects a chat request. */
export type EndpointStyle = "auto" | "chat-completions" | "messages" | "responses";

export type ProviderKind = "openai-codex" | "kiro" | "custom";

export type ModelSource = "puter" | "openai-codex" | "kiro" | "custom";

export interface ModelSupports {
  streaming?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  tools?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface CapabilityFlags {
  streaming: boolean;
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
}

export interface ResolvedCapabilities extends CapabilityFlags {
  reasoningEffort?: string;
}

/**
 * A connected account. Tokens live in this browser only and are forwarded to
 * the provider (via the local bridge when it is connected).
 */
export interface ProviderAccount {
  id: string;
  kind: ProviderKind;
  label: string;
  enabled: boolean;
  createdAt: number;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  accountId?: string;
  region?: string;
  authMethod?: "idc" | "social";
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  apiKey?: string;
  /** User-selected wire format. `auto` is resolved from the live models response. */
  endpoint?: EndpointStyle;
  /** Set after a successful models fetch. Not a hardcoded catalog. */
  detectedEndpoint?: Exclude<EndpointStyle, "auto">;
  apiBase?: string;
  modelsUrl?: string;
}

export interface ModelOverride {
  /** `${accountId || provider}::${modelId}` */
  key: string;
  streaming?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  tools?: boolean;
}

/** A model the user added by id when the provider did not list it. */
export interface CustomModelEntry {
  id: string;
  providerId: string;
  name: string;
  streaming: boolean;
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
}

export interface AuthFlowState {
  provider: "openai-codex" | "kiro";
  phase: "starting" | "waiting" | "done" | "error";
  message: string;
  authorizeUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  backend?: "api" | "bridge";
}

export type SettingsTab = "appearance" | "providers" | "models" | "permissions" | "bridge" | "safety" | "shortcuts" | "diagnostics";

export function accountKey(accountId: string | undefined, modelId: string, provider?: string): string {
  return `${accountId || provider || "model"}::${modelId}`;
}

export function publicAccount(account: ProviderAccount): ProviderAccount {
  return {
    ...account,
    accessToken: account.accessToken ? "set" : undefined,
    refreshToken: account.refreshToken ? "set" : undefined,
    idToken: undefined,
    apiKey: account.apiKey ? "set" : undefined,
    clientSecret: account.clientSecret ? "set" : undefined,
  };
}

export function hasSecret(account: ProviderAccount): boolean {
  return Boolean(account.accessToken || account.apiKey);
}

