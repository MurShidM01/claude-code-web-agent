import { createServer, type Server } from "node:http";
import type { ChatRequest, ModelInfo, ModelStreamEvent } from "@/lib/model/types";
import {
  BUILDER_ID_REGION,
  BUILDER_ID_START_URL,
  CODEX_PUBLIC_CLIENT_ID,
  CODEX_SERVICE_ROOTS,
  KIRO_SCOPES,
  OPENAI_ISSUER,
  accountIdFromClaims,
  buildCodexAuthorizeUrl,
  callbackParts,
  createPkce,
  emailFromClaims,
  jwtClaims,
  kiroOidcBase,
  randomState,
} from "@/lib/providers/auth";
import { discoverOpenId, guessEndpoint, isSafeProviderUrl, modelProbeUrls, modelUrlsFromDiscovery, modelsFromPayload } from "@/lib/providers/discover";
import { StreamDecoder, buildUpstreamCall, errorMessage } from "@/lib/providers/formats";
import type { ProviderAccount, ResolvedCapabilities } from "@/lib/providers/types";
import { createId } from "@/lib/id";

export type ProviderHttpResult =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream"; events: AsyncIterable<ModelStreamEvent> };

interface LoginSession {
  kind: "openai-codex" | "kiro";
  createdAt: number;
  verifier?: string;
  redirectUri?: string;
  clientId?: string;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  code?: string;
  account?: ProviderAccount;
  error?: string;
  exchanging?: Promise<void>;
  region?: string;
  deviceCode?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  interval?: number;
  expiresAt?: number;
  nextPollAt?: number;
  emailHint?: string;
}

const sessions = new Map<string, LoginSession>();
let listener: { server: Server; port: number; redirectUri: string } | null = null;

export async function handleProviderRequest(input: {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body: unknown;
  signal?: AbortSignal;
}): Promise<ProviderHttpResult> {
  sweep();
  const path = input.pathname.replace(/\/+$/, "") || "/";
  const method = input.method.toUpperCase();
  try {
    if (method === "POST" && path === "/oauth/openai/start") return json(200, await startOpenAI());
    if (method === "GET" && path === "/oauth/openai/poll") return json(200, await pollOpenAI(input.searchParams.get("state") || ""));
    if (method === "POST" && path === "/oauth/openai/exchange") return json(200, await exchangePasted(input.body));
    if (method === "POST" && path === "/oauth/openai/refresh") return json(200, { ok: true, account: await refreshOpenAI(accountFrom(input.body)) });
    if (method === "POST" && path === "/oauth/kiro/start") return json(200, await startKiro(input.body));
    if (method === "GET" && path === "/oauth/kiro/poll") return json(200, await pollKiro(input.searchParams.get("state") || ""));
    if (method === "POST" && path === "/oauth/kiro/refresh") return json(200, { ok: true, account: await refreshKiro(accountFrom(input.body)) });
    if (method === "POST" && path === "/models") return json(200, await listForAccount(accountFrom(input.body)));
    if (method === "POST" && path === "/chat") return streamChat(input.body, input.signal);
    return json(404, { ok: false, error: { message: `No provider route for ${method} ${path}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed.";
    return json(400, { ok: false, error: { message } });
  }
}

export async function closeAuthListener(): Promise<void> {
  const current = listener;
  listener = null;
  if (!current) return;
  await new Promise<void>((resolve) => current.server.close(() => resolve()));
}

async function startOpenAI() {
  const oidc = await discoverOpenId(OPENAI_ISSUER);
  const clientId = oidc.clientId || CODEX_PUBLIC_CLIENT_ID;
  let redirectUri = "http://localhost:1455/auth/callback";
  let listening = false;
  let listenerError: string | undefined;
  try {
    const bound = await listenForCallback();
    redirectUri = bound.redirectUri;
    listening = true;
  } catch (error) {
    listenerError = error instanceof Error ? error.message : "Could not open the local callback port.";
  }
  const pkce = await createPkce();
  const state = randomState();
  sessions.set(state, {
    kind: "openai-codex",
    createdAt: Date.now(),
    verifier: pkce.verifier,
    redirectUri,
    clientId,
    tokenEndpoint: oidc.tokenEndpoint,
    authorizationEndpoint: oidc.authorizationEndpoint,
  });
  return {
    ok: true,
    state,
    authorizeUrl: buildCodexAuthorizeUrl({
      authorizationEndpoint: oidc.authorizationEndpoint,
      clientId,
      redirectUri,
      challenge: pkce.challenge,
      state,
    }),
    redirectUri,
    listener: listening,
    listenerError,
  };
}

async function pollOpenAI(state: string) {
  const session = requireSession(state, "openai-codex");
  if (session.account) return { ok: true, status: "ready", account: session.account };
  if (session.error) return { ok: false, status: "error", error: { message: session.error } };
  if (session.code && !session.exchanging) session.exchanging = finishOpenAI(session).finally(() => { session.exchanging = undefined; });
  if (session.exchanging) await session.exchanging;
  if (session.account) return { ok: true, status: "ready", account: session.account };
  if (session.error) return { ok: false, status: "error", error: { message: session.error } };
  return { ok: true, status: "pending" };
}

async function exchangePasted(body: unknown) {
  const record = asRecord(body);
  const parts = callbackParts(String(record?.callbackUrl || record?.url || ""));
  if (parts.error) throw new Error(parts.error);
  if (!parts.code || !parts.state) throw new Error("Paste the full callback URL. It should contain code and state.");
  const session = requireSession(parts.state, "openai-codex");
  session.code = parts.code;
  await finishOpenAI(session);
  if (session.error || !session.account) throw new Error(session.error || "OpenAI did not return a token.");
  return { ok: true, status: "ready", account: session.account };
}

async function finishOpenAI(session: LoginSession) {
  if (session.account || session.error) return;
  if (!session.code || !session.verifier || !session.redirectUri || !session.clientId || !session.tokenEndpoint) {
    session.error = "The OpenAI sign-in session is incomplete. Start again.";
    return;
  }
  const response = await fetch(session.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: session.code,
      redirect_uri: session.redirectUri,
      client_id: session.clientId,
      code_verifier: session.verifier,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    session.error = errorMessage(response.status, text);
    return;
  }
  session.account = accountFromOpenAIToken(JSON.parse(text) as Record<string, unknown>, session.clientId);
}

function accountFromOpenAIToken(token: Record<string, unknown>, clientId: string): ProviderAccount {
  const access = String(token.access_token || "");
  const idToken = typeof token.id_token === "string" ? token.id_token : undefined;
  const claims = jwtClaims(idToken || access);
  const accountId = accountIdFromClaims(claims);
  const email = emailFromClaims(claims);
  return {
    id: createId("acct"),
    kind: "openai-codex",
    label: email ? `OpenAI · ${email}` : "OpenAI Code",
    enabled: true,
    createdAt: Date.now(),
    email,
    accessToken: access,
    refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    idToken,
    expiresAt: typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined,
    accountId,
    clientId,
    endpoint: "responses",
    detectedEndpoint: "responses",
  };
}

async function refreshOpenAI(account: ProviderAccount): Promise<ProviderAccount> {
  if (!account.refreshToken) return account;
  const oidc = await discoverOpenId(OPENAI_ISSUER).catch(() => null);
  const response = await fetch(oidc?.tokenEndpoint || `${OPENAI_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: account.clientId || oidc?.clientId || CODEX_PUBLIC_CLIENT_ID,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(errorMessage(response.status, text));
  const next = accountFromOpenAIToken(JSON.parse(text) as Record<string, unknown>, account.clientId || CODEX_PUBLIC_CLIENT_ID);
  return { ...account, ...next, id: account.id, label: account.label, createdAt: account.createdAt, apiBase: account.apiBase, modelsUrl: account.modelsUrl };
}

async function startKiro(body: unknown) {
  const record = asRecord(body) ?? {};
  const region = typeof record.region === "string" && record.region.trim() ? record.region.trim() : BUILDER_ID_REGION;
  const startUrl = typeof record.startUrl === "string" && record.startUrl.trim() ? record.startUrl.trim() : BUILDER_ID_START_URL;
  if (!isSafeProviderUrl(startUrl)) throw new Error("The Identity Center start URL must be https.");
  const base = kiroOidcBase(region);
  const register = await fetch(`${base}/client/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "KiroIDE" },
    body: JSON.stringify({
      clientName: "Kiln",
      clientType: "public",
      scopes: KIRO_SCOPES,
      grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    }),
  });
  const registeredText = await register.text();
  if (!register.ok) throw new Error(errorMessage(register.status, registeredText));
  const registered = JSON.parse(registeredText) as { clientId?: string; clientSecret?: string };
  if (!registered.clientId || !registered.clientSecret) throw new Error("Kiro client registration did not return a client id.");
  const device = await fetch(`${base}/device_authorization`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "KiroIDE" },
    body: JSON.stringify({ clientId: registered.clientId, clientSecret: registered.clientSecret, startUrl }),
  });
  const deviceText = await device.text();
  if (!device.ok) throw new Error(errorMessage(device.status, deviceText));
  const data = JSON.parse(deviceText) as Record<string, unknown>;
  const userCode = String(data.userCode || data.user_code || "");
  const deviceCode = String(data.deviceCode || data.device_code || "");
  const verificationUrl = String(data.verificationUriComplete || data.verificationUri || data.verification_uri_complete || data.verification_uri || "");
  if (!userCode || !deviceCode || !verificationUrl) throw new Error("Kiro did not return a device code.");
  const state = randomState();
  sessions.set(state, {
    kind: "kiro",
    createdAt: Date.now(),
    region,
    deviceCode,
    oidcClientId: registered.clientId,
    oidcClientSecret: registered.clientSecret,
    interval: typeof data.interval === "number" ? data.interval : 5,
    expiresAt: Date.now() + (typeof data.expiresIn === "number" ? data.expiresIn : 600) * 1000,
  });
  return { ok: true, state, userCode, verificationUrl, region, interval: typeof data.interval === "number" ? data.interval : 5 };
}

async function pollKiro(state: string) {
  const session = requireSession(state, "kiro");
  if (session.account) return { ok: true, status: "ready", account: session.account };
  if (session.error) return { ok: false, status: "error", error: { message: session.error } };
  if (session.expiresAt && Date.now() > session.expiresAt) {
    session.error = "The Kiro device code expired. Start sign-in again.";
    return { ok: false, status: "error", error: { message: session.error } };
  }
  if (session.nextPollAt && Date.now() < session.nextPollAt) return { ok: true, status: "pending" };
  session.nextPollAt = Date.now() + Math.max(1, session.interval || 5) * 1000;
  const base = kiroOidcBase(session.region || BUILDER_ID_REGION);
  const response = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "KiroIDE" },
    body: JSON.stringify({
      clientId: session.oidcClientId,
      clientSecret: session.oidcClientSecret,
      deviceCode: session.deviceCode,
      grantType: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    session.error = errorMessage(response.status, text);
    return { ok: false, status: "error", error: { message: session.error } };
  }
  const error = typeof data.error === "string" ? data.error : "";
  if (error === "authorization_pending" || error === "slow_down") {
    if (error === "slow_down") session.interval = (session.interval || 5) + 5;
    return { ok: true, status: "pending" };
  }
  if (error) {
    session.error = typeof data.error_description === "string" ? data.error_description : error;
    return { ok: false, status: "error", error: { message: session.error } };
  }
  const access = String(data.accessToken || data.access_token || "");
  const refresh = String(data.refreshToken || data.refresh_token || "");
  if (!access || !refresh) {
    session.error = "Kiro did not return tokens.";
    return { ok: false, status: "error", error: { message: session.error } };
  }
  const claims = jwtClaims(access);
  const email = emailFromClaims(claims);
  session.account = {
    id: createId("acct"),
    kind: "kiro",
    label: email ? `Kiro · ${email}` : `Kiro · ${session.region}`,
    enabled: true,
    createdAt: Date.now(),
    email,
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + (Number(data.expiresIn || data.expires_in || 3600) || 3600) * 1000,
    region: session.region,
    authMethod: "idc",
    clientId: session.oidcClientId,
    clientSecret: session.oidcClientSecret,
  };
  return { ok: true, status: "ready", account: session.account };
}

async function refreshKiro(account: ProviderAccount): Promise<ProviderAccount> {
  if (!account.refreshToken || !account.clientId || !account.clientSecret) return account;
  const base = kiroOidcBase(account.region || BUILDER_ID_REGION);
  const response = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "KiroIDE" },
    body: JSON.stringify({
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      refreshToken: account.refreshToken,
      grantType: "refresh_token",
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(errorMessage(response.status, text));
  const data = JSON.parse(text) as Record<string, unknown>;
  return {
    ...account,
    accessToken: String(data.accessToken || data.access_token || account.accessToken),
    refreshToken: String(data.refreshToken || data.refresh_token || account.refreshToken),
    expiresAt: Date.now() + (Number(data.expiresIn || data.expires_in || 3600) || 3600) * 1000,
  };
}

async function listForAccount(account: ProviderAccount): Promise<{ ok: true; models: ModelInfo[]; account: ProviderAccount; notice?: string }> {
  const fresh = await maybeRefresh(account);
  if (fresh.kind === "openai-codex") return listCodex(fresh);
  if (fresh.kind === "kiro") return listKiro(fresh);
  return listCustom(fresh);
}

async function listCodex(account: ProviderAccount) {
  const oidc = await discoverOpenId(OPENAI_ISSUER).catch(() => null);
  const discovered = oidc ? modelUrlsFromDiscovery(oidc.raw) : [];
  const roots = [...discovered, ...CODEX_SERVICE_ROOTS.flatMap((root) => modelProbeUrls(root))];
  const headers: Record<string, string> = { authorization: `Bearer ${account.accessToken}`, accept: "application/json" };
  if (account.accountId) headers["chatgpt-account-id"] = account.accountId;
  const found = await firstModelPayload(roots, headers);
  if (!found) {
    return { ok: true as const, models: [], account, notice: "Signed in, but the account did not return a model list. Add a model id under Models." };
  }
  const endpoint = guessEndpoint(found.url, found.payload);
  const apiBase = found.url.replace(/\/models(?:\?.*)?$/, "").replace(/\/v1\/models(?:\?.*)?$/, "/v1");
  const next = { ...account, modelsUrl: found.url, apiBase, detectedEndpoint: endpoint, endpoint: "responses" as const };
  return { ok: true as const, models: modelsFromPayload(found.payload, { provider: "openai-codex", source: "openai-codex", accountId: account.id, endpoint: "responses" }), account: next };
}

async function listKiro(account: ProviderAccount) {
  const attempts = kiroCatalogAttempts(account);
  let last = "";
  for (const attempt of attempts) {
    if (!isSafeProviderUrl(attempt.url)) continue;
    try {
      const collected: ModelInfo[] = [];
      let nextToken: string | undefined;
      let payload: Record<string, unknown> | null = null;
      for (let page = 0; page < 8; page += 1) {
        const response = await fetch(attempt.url, {
          method: attempt.method,
          headers: attempt.headers,
          body: attempt.method === "GET" ? undefined : JSON.stringify({ ...attempt.body, ...(nextToken ? { nextToken } : {}) }),
        });
        const text = await response.text();
        if (!response.ok) {
          last = errorMessage(response.status, text);
          payload = null;
          break;
        }
        payload = JSON.parse(text) as Record<string, unknown>;
        collected.push(...modelsFromPayload(payload, { provider: "kiro", source: "kiro", accountId: account.id }));
        nextToken = typeof payload.nextToken === "string" ? payload.nextToken : undefined;
        if (!nextToken) break;
      }
      if (payload && collected.length) {
        return {
          ok: true as const,
          models: collected,
          account: { ...account, apiBase: new URL(attempt.url).origin, modelsUrl: attempt.url },
        };
      }
    } catch (error) {
      last = error instanceof Error ? error.message : "Kiro model fetch failed.";
    }
  }
  return {
    ok: true as const,
    models: [] as ModelInfo[],
    account,
    notice: last
      ? `Signed in, but Kiro did not return a model list (${last}). Add a model id under Models.`
      : "Kiro did not return any models for this account. Add a model id under Models.",
  };
}

function kiroCatalogAttempts(account: ProviderAccount) {
  const region = account.region || BUILDER_ID_REGION;
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) return [];
  const claims = jwtClaims(account.accessToken || "");
  const profileArn = typeof claims?.profileArn === "string" ? claims.profileArn : undefined;
  const auth = { authorization: `Bearer ${account.accessToken || ""}`, accept: "application/json" };
  const json = { ...auth, "content-type": "application/json", "x-amz-user-agent": "aws-sdk-js/3.0.0 KiroIDE" };
  const editor = { origin: "AI_EDITOR", ...(profileArn ? { profileArn } : {}) };
  return [
    { url: `https://q.${region}.amazonaws.com/ListAvailableModels`, method: "POST" as const, headers: json, body: editor },
    { url: `https://codewhisperer.${region}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR`, method: "GET" as const, headers: auth, body: editor },
    { url: `https://codewhisperer.${region}.amazonaws.com/ListAvailableModels`, method: "POST" as const, headers: json, body: editor },
    {
      url: `https://management.${region}.kiro.dev/`,
      method: "POST" as const,
      headers: { ...auth, "content-type": "application/x-amz-json-1.0", "x-amz-target": "AmazonCodeWhispererService.ListAvailableModels" },
      body: profileArn ? { origin: "KIRO_CLI", profileArn } : editor,
    },
  ];
}

async function listCustom(account: ProviderAccount) {
  const base = account.baseUrl;
  if (!base) throw new Error("Base URL is required.");
  const urls = modelProbeUrls(base, account.modelsUrl);
  const headers: Record<string, string> = { accept: "application/json" };
  if (account.apiKey) headers.authorization = `Bearer ${account.apiKey}`;
  if (account.endpoint === "messages" && account.apiKey) {
    headers["x-api-key"] = account.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  const found = await firstModelPayload(urls, headers);
  if (!found) {
    return { ok: true as const, models: [], account, notice: "No models endpoint responded. Add a model id manually — nothing is invented." };
  }
  const detected = account.endpoint && account.endpoint !== "auto" ? account.endpoint : guessEndpoint(base, found.payload);
  const next = { ...account, modelsUrl: found.url, detectedEndpoint: detected, apiBase: base.replace(/\/$/, "") };
  return {
    ok: true as const,
    models: modelsFromPayload(found.payload, { provider: account.label || "custom", source: "custom", accountId: account.id, endpoint: detected }),
    account: next,
  };
}

async function firstModelPayload(urls: string[], headers: Record<string, string>): Promise<{ url: string; payload: unknown } | null> {
  let last = "";
  for (const url of urls) {
    if (!isSafeProviderUrl(url, true)) continue;
    try {
      const response = await fetch(url, { headers });
      const text = await response.text();
      if (!response.ok) {
        last = errorMessage(response.status, text);
        continue;
      }
      const payload = JSON.parse(text) as unknown;
      if (modelsFromPayload(payload, { provider: "probe", source: "custom" }).length || Array.isArray((payload as { data?: unknown }).data) || Array.isArray((payload as { models?: unknown }).models)) {
        return { url, payload };
      }
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed";
    }
  }
  if (last) throw new Error(last);
  return null;
}

async function streamChat(body: unknown, signal?: AbortSignal): Promise<ProviderHttpResult> {
  const record = asRecord(body);
  if (!record) throw new Error("Missing chat body.");
  const account = await maybeRefresh(accountFrom(record));
  const request = record.request as ChatRequest;
  const caps = (record.caps || {}) as ResolvedCapabilities;
  if (!request?.model) throw new Error("Choose a model first.");
  const call = buildUpstreamCall(account, { ...request, signal: signal ?? new AbortController().signal }, caps);
  const response = await fetch(call.url, {
    method: "POST",
    headers: call.headers,
    body: JSON.stringify(call.body),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(errorMessage(response.status, text));
  }
  const style = call.style;
  const contentType = response.headers.get("content-type") || "";
  return {
    kind: "stream",
    events: (async function* () {
      const decoder = new StreamDecoder(style);
      if (!contentType.includes("text/event-stream") && !contentType.includes("eventstream") && caps.streaming === false) {
        const text = await response.text();
        for (const event of decoder.finish(text)) yield event;
        return;
      }
      const reader = response.body!.getReader();
      const textDecoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const text = textDecoder.decode(chunk.value, { stream: true });
        if (contentType.includes("eventstream") || style === "kiro") {
          for (const event of decoder.push(Buffer.from(chunk.value).toString("binary"))) yield event;
        } else {
          for (const event of decoder.push(text)) yield event;
        }
      }
      for (const event of decoder.finish()) yield event;
    })(),
  };
}

async function maybeRefresh(account: ProviderAccount): Promise<ProviderAccount> {
  if (!account.expiresAt || account.expiresAt > Date.now() + 60_000) return account;
  if (account.kind === "openai-codex") return refreshOpenAI(account);
  if (account.kind === "kiro") return refreshKiro(account);
  return account;
}

function requireSession(state: string, kind: LoginSession["kind"]): LoginSession {
  const session = sessions.get(state);
  if (!session || session.kind !== kind) throw new Error("That sign-in expired. Start again.");
  return session;
}

function accountFrom(body: unknown): ProviderAccount {
  const record = asRecord(body);
  const account = asRecord(record?.account) || record;
  if (!account || typeof account.id !== "string" || typeof account.kind !== "string") throw new Error("Missing provider account.");
  return account as unknown as ProviderAccount;
}

async function listenForCallback(): Promise<{ port: number; redirectUri: string }> {
  if (listener) return { port: listener.port, redirectUri: listener.redirectUri };
  let last = "port in use";
  for (const port of [1455, 1457]) {
    try {
      const server = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not found");
          return;
        }
        const result = noteCallback(url);
        res.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
        res.end(result.html);
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
      const redirectUri = `http://localhost:${port}/auth/callback`;
      listener = { server, port, redirectUri };
      return { port, redirectUri };
    } catch (error) {
      last = error instanceof Error ? error.message : "port in use";
    }
  }
  throw new Error(`Could not listen on localhost:1455 or :1457 (${last}). Paste the callback URL after you sign in.`);
}

function noteCallback(url: URL): { status: number; html: string } {
  const state = url.searchParams.get("state") || "";
  const session = sessions.get(state);
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (!session) return { status: 400, html: page("Sign-in was not recognized", "Start again from Kiln settings.") };
  if (error) {
    session.error = error;
    return { status: 400, html: page("Sign-in failed", error) };
  }
  const code = url.searchParams.get("code");
  if (!code) return { status: 400, html: page("Missing code", "The account chooser did not return a code.") };
  session.code = code;
  void finishOpenAI(session);
  return { status: 200, html: page("Signed in", "You can close this window and return to Kiln.") };
}

function page(title: string, message: string): string {
  const safe = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(title)}</title></head><body style="font-family:system-ui;background:#181715;color:#faf9f5;display:grid;place-items:center;height:100vh;margin:0"><main style="text-align:center;max-width:420px"><h1 style="font-size:22px">${safe(title)}</h1><p style="color:#b4b0a7">${safe(message)}</p></main></body></html>`;
}

function json(status: number, body: unknown): ProviderHttpResult {
  return { kind: "json", status, body };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sweep() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [key, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(key);
  }
}
