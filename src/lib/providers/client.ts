import type { Settings } from "@/lib/persistence/settings";
import type { ProviderAccount } from "@/lib/providers/types";
import { ModelError, type ModelInfo, type ModelStreamEvent } from "@/lib/model/types";

export interface ProviderTarget {
  kind: "api" | "bridge-proxy" | "bridge-direct";
  host?: string;
  port?: number;
  token?: string;
}

export function pageIsLocal(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function targetFromBridge(input: {
  status: string;
  transport: string;
  settings: Pick<Settings, "bridgeHost" | "bridgePort">;
}): ProviderTarget | null {
  if (input.status !== "connected") return null;
  if (input.transport === "proxy") return { kind: "bridge-proxy" };
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem("kiln.bridgeToken");
  if (!token) return null;
  return { kind: "bridge-direct", host: input.settings.bridgeHost, port: input.settings.bridgePort, token };
}

export function loginTarget(input: { status: string; transport: string; settings: Pick<Settings, "bridgeHost" | "bridgePort"> }, needsLocalCallback: boolean): ProviderTarget {
  const bridge = targetFromBridge(input);
  if (bridge) return bridge;
  if (!needsLocalCallback || pageIsLocal()) return { kind: "api" };
  throw new ModelError(
    "OpenAI sign-in returns to localhost on this computer. Start the Kiln bridge here, pair it, then try again.",
    "auth_bridge",
    false,
  );
}

export async function providerRequest<T>(path: string, target: ProviderTarget, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const response = await fetch(urlFor(target, path), {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: headersFor(target, Boolean(init?.body)),
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  const data = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: { message?: string } };
  if (!response.ok || data?.ok === false) {
    throw new ModelError(data?.error?.message || `Provider request failed (${response.status}).`, "provider", response.status >= 500 || response.status === 429);
  }
  return data;
}

export async function* providerStream(path: string, target: ProviderTarget, body: unknown, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
  const response = await fetch(urlFor(target, path), {
    method: "POST",
    headers: headersFor(target, true),
    body: JSON.stringify(body),
    signal,
  });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("text/event-stream") || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new ModelError(data.error?.message || `The provider returned ${response.status}.`, "provider", response.status >= 500 || response.status === 429);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      yield JSON.parse(data) as ModelStreamEvent;
    }
  }
}

export interface ListedModels {
  models: ModelInfo[];
  account: ProviderAccount;
  notice?: string;
}

export function urlFor(target: ProviderTarget, path: string): string {
  if (target.kind === "bridge-proxy") return `/api/bridge${path}`;
  if (target.kind === "bridge-direct") return `http://${target.host}:${target.port}/v1${path}`;
  return `/api/provider${path}`;
}

function headersFor(target: ProviderTarget, json: boolean): Headers {
  const headers = new Headers();
  if (json) headers.set("content-type", "application/json");
  if (target.kind === "bridge-direct" && target.token) headers.set("authorization", `Bearer ${target.token}`);
  return headers;
}
