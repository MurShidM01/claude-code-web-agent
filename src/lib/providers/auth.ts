/**
 * OAuth helpers for providers whose login is a live protocol, not a model list.
 * Endpoints come from the identity provider's discovery document when it
 * publishes them. The Codex public client id is not a secret — it is the
 * client the account chooser at auth.openai.com is registered for — and is
 * used only when discovery does not include one.
 */

export const OPENAI_ISSUER = "https://auth.openai.com";
export const CODEX_PUBLIC_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

/** Published Codex service roots. Tried only after discovery yields no models URL. */
export const CODEX_SERVICE_ROOTS = ["https://chatgpt.com/backend-api/codex", "https://api.openai.com/v1"] as const;

/** AWS Builder ID home. Overridable; not a model catalog. */
export const BUILDER_ID_REGION = "us-east-1";
export const BUILDER_ID_START_URL = "https://view.awsapps.com/start";

export const KIRO_SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations",
  "codewhisperer:transformations",
  "codewhisperer:taskassist",
];

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function createPkce(): Promise<PkcePair> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

export function buildCodexAuthorizeUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    prompt: "select_account",
    state: input.state,
    originator: "kiln",
  });
  return `${input.authorizationEndpoint}?${params.toString()}`;
}

export function jwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload || payload.length > 8192) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function accountIdFromClaims(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined;
  if (typeof claims.chatgpt_account_id === "string" && claims.chatgpt_account_id) return claims.chatgpt_account_id;
  const nested = claims["https://api.openai.com/auth"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const id = (nested as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    if (typeof id === "string" && id) return id;
  }
  const orgs = claims.organizations;
  if (Array.isArray(orgs)) {
    const first = orgs[0] as { id?: unknown } | undefined;
    if (typeof first?.id === "string" && first.id) return first.id;
  }
  return undefined;
}

export function emailFromClaims(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined;
  for (const key of ["email", "preferred_username", "name"]) {
    const value = claims[key];
    if (typeof value === "string" && value.includes("@")) return value;
  }
  return typeof claims.email === "string" ? claims.email : undefined;
}

export function kiroOidcBase(region: string): string {
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error("Region should look like us-east-1.");
  return `https://oidc.${region}.amazonaws.com`;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function callbackParts(value: string): { code?: string; state?: string; error?: string } {
  const trimmed = value.trim();
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(`http://localhost/auth/callback?${trimmed.replace(/^\?/, "")}`);
    return {
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
      error: url.searchParams.get("error_description") || url.searchParams.get("error") || undefined,
    };
  } catch {
    return {};
  }
}
