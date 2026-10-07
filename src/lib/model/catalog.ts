import type { ModelCatalog, ModelInfo } from "@/lib/model/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function capabilityFields(raw: Record<string, unknown>): string[] {
  const caps: string[] = [];
  const keys = [
    "tools",
    "function_calling",
    "functionCalling",
    "vision",
    "reasoning",
    "streaming",
    "json_mode",
    "modalities",
    "capabilities",
  ];
  for (const key of keys) {
    const value = raw[key];
    if (value === true) caps.push(key);
    else if (typeof value === "string") caps.push(`${key}:${value}`);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") caps.push(item);
      }
    }
  }
  return [...new Set(caps)];
}

export function normalizeModel(raw: unknown, fallbackProvider?: string): ModelInfo | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = asString(record.id) ?? asString(record.name) ?? asString(record.model);
  if (!id) return null;
  const provider =
    asString(record.provider) ??
    asString(record.vendor) ??
    fallbackProvider ??
    (id.includes("/") ? id.split("/")[0] : "unknown");
  const name = asString(record.name) ?? asString(record.display_name) ?? asString(record.label) ?? id;
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.filter((item): item is string => typeof item === "string")
    : [];
  const costRecord = asRecord(record.cost);
  const cost = costRecord
    ? {
        currency: asString(costRecord.currency) ?? "usd-cents",
        perTokens: asNumber(costRecord.tokens) ?? 1_000_000,
        input: asNumber(costRecord.input),
        output: asNumber(costRecord.output),
      }
    : undefined;
  return {
    id,
    provider: provider ?? "unknown",
    name,
    aliases,
    contextWindow: asNumber(record.context) ?? asNumber(record.context_window) ?? asNumber(record.contextWindow),
    maxOutputTokens:
      asNumber(record.max_tokens) ?? asNumber(record.maxOutputTokens) ?? asNumber(record.max_output_tokens),
    cost,
    capabilities: capabilityFields(record),
    releasedAt: asString(record.released_at) ?? asString(record.release_date),
  };
}

export function normalizeCatalog(models: unknown[], providers: string[] = []): ModelCatalog {
  const seen = new Set<string>();
  const normalized: ModelInfo[] = [];
  for (const item of models) {
    const model = normalizeModel(item);
    if (!model) continue;
    const key = `${model.provider}::${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(model);
  }
  normalized.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  const discovered = [...new Set(normalized.map((model) => model.provider))].sort();
  const mergedProviders = [...new Set([...providers.filter(Boolean), ...discovered])].sort();
  return { models: normalized, providers: mergedProviders, loadedAt: Date.now() };
}

export type ModelSort = "name" | "provider" | "context";

export function queryModels(
  catalog: ModelCatalog,
  input: { search?: string; provider?: string; sort?: ModelSort; toolCapableOnly?: boolean },
): ModelInfo[] {
  const search = input.search?.trim().toLowerCase() ?? "";
  let models = catalog.models.filter((model) => {
    if (input.provider && input.provider !== "all" && model.provider !== input.provider) return false;
    if (input.toolCapableOnly && model.capabilities.length && !model.capabilities.some((cap) => /tool|function/i.test(cap))) {
      return false;
    }
    if (!search) return true;
    return (
      model.name.toLowerCase().includes(search) ||
      model.id.toLowerCase().includes(search) ||
      model.provider.toLowerCase().includes(search) ||
      model.aliases.some((alias) => alias.toLowerCase().includes(search))
    );
  });
  const sort = input.sort ?? "name";
  models = [...models].sort((a, b) => {
    if (sort === "provider") return a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
    if (sort === "context") return (b.contextWindow ?? 0) - (a.contextWindow ?? 0) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider);
  });
  return models;
}

export function groupModels(models: ModelInfo[]): { provider: string; models: ModelInfo[] }[] {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const list = groups.get(model.provider) ?? [];
    list.push(model);
    groups.set(model.provider, list);
  }
  return [...groups.entries()].map(([provider, items]) => ({ provider, models: items }));
}

export function findModel(catalog: ModelCatalog | null, id: string | null, provider?: string | null): ModelInfo | null {
  if (!catalog || !id) return null;
  return (
    catalog.models.find((model) => model.id === id && (!provider || model.provider === provider)) ??
    catalog.models.find((model) => model.id === id || model.aliases.includes(id)) ??
    null
  );
}
