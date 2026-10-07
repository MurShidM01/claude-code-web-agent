import type { Settings } from "@/lib/persistence/settings";
import { PuterModelTransport } from "@/lib/model/puter";
import { ModelError, type ChatRequest, type ModelInfo, type ModelStreamEvent, type ModelTransport } from "@/lib/model/types";
import { loginTarget, pageIsLocal, providerRequest, providerStream, targetFromBridge, type ListedModels, type ProviderTarget } from "@/lib/providers/client";
import { resolveCapabilities } from "@/lib/providers/discover";
import type { CustomModelEntry, ProviderAccount } from "@/lib/providers/types";
import { hasSecret } from "@/lib/providers/types";

export interface RouterContext {
  settings: Settings;
  bridgeStatus: string;
  bridgeTransport: string;
}

/**
 * One transport over every connected account. Model ids come from each
 * provider's live list (or a model the user added). Nothing is invented here.
 */
export class RoutedModelTransport implements ModelTransport {
  readonly name = "routed";
  lastNotice: string | null = null;
  private puter: ModelTransport = new PuterModelTransport();
  private index = new Map<string, ModelInfo>();

  constructor(
    private readonly read: () => RouterContext,
    private readonly onAccount?: (account: ProviderAccount) => void,
    /** Injectable for tests; production always uses the real Puter client. */
    puter?: ModelTransport,
  ) {
    if (puter) this.puter = puter;
  }

  async listProviders(): Promise<string[]> {
    const models = await this.listModels();
    return [...new Set(models.map((model) => model.provider))].sort();
  }

  async listModels(): Promise<ModelInfo[]> {
    const ctx = this.read();
    const notices: string[] = [];
    const chunks: ModelInfo[][] = [];
    // Providers that fail to list this time keep working from the ids we
    // learned earlier in the session, so an in-flight chat never loses the
    // model the user picked because of a transient 502 from a models route.
    const stale = new Set<string>();
    try {
      const puterModels = await this.puter.listModels();
      chunks.push(puterModels.map((model) => ({ ...model, source: model.source ?? "puter" })));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message && !/sign|auth|signed/i.test(message)) notices.push(message);
      stale.add("puter");
    }
    const target = targetFromBridge({ status: ctx.bridgeStatus, transport: ctx.bridgeTransport, settings: ctx.settings }) ?? { kind: "api" as const };
    for (const account of ctx.settings.providers.filter((item) => item.enabled && hasSecret(item))) {
      try {
        const listed = await providerRequest<ListedModels & { ok: true }>("/models", target, { body: { account } });
        if (listed.account) this.onAccount?.(listed.account);
        if (listed.notice) notices.push(listed.notice);
        chunks.push(listed.models ?? []);
      } catch (error) {
        notices.push(error instanceof Error ? error.message : `Could not list models for ${account.label}.`);
        stale.add(account.id);
      }
    }
    chunks.push(customModels(ctx.settings));
    // Carry over anything we already knew from a previous successful listing.
    for (const model of this.index.values()) {
      const source = model.source ?? (model.accountId ? "" : "puter");
      if (source === "puter" && stale.has("puter")) chunks.push([model]);
      if (model.accountId && stale.has(model.accountId)) chunks.push([model]);
    }
    const models = dedupe(chunks.flat());
    this.index = new Map(models.map((model) => [lookupKey(model), model]));
    this.lastNotice = notices.filter(Boolean).join(" ");
    if (!models.length && this.lastNotice) throw new ModelError(this.lastNotice, "catalog", true);
    return models;
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ModelStreamEvent> {
    let model = this.find(request);
    if (!model) {
      // The index is built by listModels(). A page that has not refreshed the
      // catalog yet — or one whose catalog was cleared — must not silently
      // send a Codex/Kiro model id to Puter. Refresh once, then decide.
      await this.listModels().catch(() => undefined);
      model = this.find(request);
    }
    // A model that came from a real provider account always goes through that
    // account, even when a stale entry says otherwise.
    const account = this.accountFor(model);
    if (account) {
      const ctx = this.read();
      const caps = resolveCapabilities(model ?? null, ctx.settings);
      const target = targetFromBridge({ status: ctx.bridgeStatus, transport: ctx.bridgeTransport, settings: ctx.settings }) ?? { kind: "api" as const };
      const fresh = await this.refreshIfNeeded(account, target);
      yield* providerStream("/chat", target, { account: fresh, request: { ...request, stream: caps.streaming, reasoning: caps.reasoning, reasoningEffort: caps.reasoningEffort }, caps }, request.signal);
      return;
    }
    // No account: Puter can serve the id only when Puter itself lists it.
    const puterModels = await this.puter.listModels().catch(() => []);
    if (model?.source === "puter" || puterModels.some((item) => item.id === request.model)) {
      yield* this.puter.streamChat(request);
      return;
    }
    throw new ModelError(
      `Kiln cannot reach a provider for “${request.model}”. Open Settings → Providers, reconnect the account, then pick the model again.`,
      "catalog",
      false,
    );
  }

  /** The account that owns a model, or undefined for Puter-hosted ids. */
  private accountFor(model: ModelInfo | undefined): ProviderAccount | undefined {
    if (!model?.accountId) return undefined;
    return this.read().settings.providers.find((item) => item.id === model.accountId);
  }

  loginTargetFor(kind: "openai-codex" | "kiro"): ProviderTarget {
    const ctx = this.read();
    return loginTarget(
      { status: ctx.bridgeStatus, transport: ctx.bridgeTransport, settings: ctx.settings },
      kind === "openai-codex",
    );
  }

  usingLocalCallback(): boolean {
    const ctx = this.read();
    return Boolean(targetFromBridge({ status: ctx.bridgeStatus, transport: ctx.bridgeTransport, settings: ctx.settings })) || pageIsLocal();
  }

  private find(request: ChatRequest): ModelInfo | undefined {
    return (
      this.index.get(`${request.provider || ""}::${request.model}`) ||
      this.index.get(`::${request.model}`) ||
      [...this.index.values()].find((model) => model.id === request.model && (!request.provider || model.provider === request.provider))
    );
  }

  private async refreshIfNeeded(account: ProviderAccount, target: ProviderTarget): Promise<ProviderAccount> {
    if (!account.expiresAt || account.expiresAt > Date.now() + 60_000 || !account.refreshToken) return account;
    const path = account.kind === "kiro" ? "/oauth/kiro/refresh" : account.kind === "openai-codex" ? "/oauth/openai/refresh" : "";
    if (!path) return account;
    const refreshed = await providerRequest<{ account: ProviderAccount }>(path, target, { body: { account } });
    this.onAccount?.(refreshed.account);
    return refreshed.account;
  }
}

function customModels(settings: Settings): ModelInfo[] {
  return settings.customModels.map((entry) => customToModel(entry, settings.providers.find((account) => account.id === entry.providerId)));
}

function customToModel(entry: CustomModelEntry, account: ProviderAccount | undefined): ModelInfo {
  return {
    id: entry.id,
    provider: account?.kind === "openai-codex" ? "openai-codex" : account?.kind === "kiro" ? "kiro" : account?.label || "custom",
    name: entry.name || entry.id,
    aliases: [],
    capabilities: [
      entry.tools ? "tools" : "",
      entry.vision ? "vision" : "",
      entry.reasoning ? "reasoning" : "",
      entry.streaming ? "streaming" : "",
    ].filter(Boolean),
    supports: { streaming: entry.streaming, reasoning: entry.reasoning, vision: entry.vision, tools: entry.tools },
    source: account?.kind === "custom" || !account ? "custom" : account.kind,
    accountId: entry.providerId,
    endpoint: account?.detectedEndpoint || account?.endpoint,
  };
}

function dedupe(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const model of models) {
    const key = lookupKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

function lookupKey(model: ModelInfo): string {
  return `${model.provider}::${model.id}`;
}
