"use client";

import { useMemo, useState } from "react";
import { AudioLines, Brain, Eye, Plus, RefreshCw, Search, Trash2, Wrench } from "lucide-react";
import { confirmed } from "@/components/ui/AlertDialog";
import type { AppController, AppState } from "@/lib/app/controller";
import type { ModelInfo } from "@/lib/model/types";
import { modelAllows } from "@/lib/providers/discover";
import { accountKey, type CapabilityFlags } from "@/lib/providers/types";

const FLAGS: { key: keyof CapabilityFlags; label: string; icon: typeof Eye; hint: string }[] = [
  { key: "vision", label: "Vision", icon: Eye, hint: "Send images" },
  { key: "tools", label: "Tools", icon: Wrench, hint: "Function calls" },
  { key: "reasoning", label: "Reasoning", icon: Brain, hint: "Thinking" },
  { key: "streaming", label: "Streaming", icon: AudioLines, hint: "Token stream" },
];

export function ModelToolsPanel({ state, controller }: { state: AppState; controller: AppController }) {
  const settings = state.settings;
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState(settings.providers[0]?.id ?? "");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [flags, setFlags] = useState<CapabilityFlags>({ vision: true, tools: true, reasoning: false, streaming: true });
  const [activeProvider, setActiveProvider] = useState<string>("all");
  const models = useMemo(() => {
    const list = state.models.catalog?.models ?? [];
    const needle = query.trim().toLowerCase();
    return list.filter((model) => {
      if (activeProvider !== "all" && model.provider !== activeProvider) return false;
      if (!needle) return true;
      return `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(needle);
    });
  }, [query, state.models.catalog, activeProvider]);

  const providers = state.models.catalog?.providers ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()].map(([provider, items]) => ({ provider, items }));
  }, [models]);

  return (
    <div className="model-panel">
      <header className="settings-head">
        <h3>Models & tools</h3>
        <p>Global switches apply to the next turn. A model toggle overrides what the provider reported. Unknown vision and reasoning stay off until the provider says so.</p>
      </header>

      <section className="settings-section">
        <h4>Global switches</h4>
        <div className="toggle-grid">
          <Toggle icon={Brain} label="Reasoning" detail="Composer brain icon. Off sends no thinking parameters." pressed={settings.reasoningEnabled} onClick={() => controller.setReasoningEnabled(!settings.reasoningEnabled)} />
          <Toggle icon={AudioLines} label="Streaming" detail="Off waits for the full response, then shows it." pressed={settings.streamingEnabled} onClick={() => controller.setStreamingEnabled(!settings.streamingEnabled)} />
          <Toggle icon={Eye} label="Vision" detail="Attach images only when the model can see them." pressed={settings.visionEnabled} onClick={() => controller.setVisionEnabled(!settings.visionEnabled)} />
          <Toggle icon={Wrench} label="Tool calling" detail="Off hides every tool schema from the model." pressed={settings.toolsEnabled} onClick={() => controller.setToolsEnabled(!settings.toolsEnabled)} />
        </div>
      </section>

      <section className="settings-section">
        <div className="section-head">
          <h4>Live catalog</h4>
          <button type="button" className="btn" onClick={() => void controller.refreshModels()}>
            <RefreshCw size={14} aria-hidden />
            Fetch
          </button>
        </div>
        <div className="catalog-bar">
          <div className="catalog-search">
            <Search size={14} aria-hidden />
            <input value={query} placeholder="Filter fetched models" aria-label="Filter models" onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>
        {providers.length ? (
          <div className="provider-chips" role="tablist" aria-label="Provider filter">
            <button type="button" className="chip" role="tab" aria-pressed={activeProvider === "all"} onClick={() => setActiveProvider("all")}>
              All <span className="chip-count">{state.models.catalog?.models.length ?? 0}</span>
            </button>
            {providers.map((provider) => {
              const count = state.models.catalog?.models.filter((m) => m.provider === provider).length ?? 0;
              return (
                <button key={provider} type="button" className="chip" role="tab" aria-pressed={activeProvider === provider} onClick={() => setActiveProvider(provider)}>
                  {provider} <span className="chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {state.models.status === "error" ? <p className="meta error">{state.models.error}</p> : null}
        {state.models.status === "loading" ? <p className="meta">Fetching models…</p> : null}
        {!models.length && state.models.status !== "loading" ? (
          <p className="meta">No models yet. Connect a provider above, or add an id below. Kiln does not invent one.</p>
        ) : null}
        <div className="model-list">
          {grouped.map((group) => (
            <div key={group.provider} className="model-group">
              <div className="model-group-head">
                <strong>{group.provider}</strong>
                <span className="meta">{group.items.length} model{group.items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="model-rows">
                {group.items.map((model) => (
                  <ModelRow key={`${model.provider}:${model.accountId ?? ""}:${model.id}`} model={model} state={state} controller={controller} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h4>Add a model by id</h4>
        <p className="meta">Use this when a provider has no models endpoint, or you already know the id you want.</p>
        <div className="custom-model-form">
          <label className="field">
            <span>Provider</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              <option value="">Choose a connected provider</option>
              {settings.providers.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          </label>
          <div className="twin">
            <label className="field">
              <span>Model id</span>
              <input value={modelId} placeholder="Exactly the id the provider expects" spellCheck={false} onChange={(event) => setModelId(event.target.value)} />
            </label>
            <label className="field">
              <span>Display name</span>
              <input value={modelName} placeholder="Optional" onChange={(event) => setModelName(event.target.value)} />
            </label>
          </div>
          <div className="cap-row" role="group" aria-label="Model capabilities">
            {FLAGS.map((flag) => {
              const Icon = flag.icon;
              return (
                <button key={flag.key} type="button" className="cap" aria-pressed={flags[flag.key]} title={flag.hint} onClick={() => setFlags((current) => ({ ...current, [flag.key]: !current[flag.key] }))}>
                  <Icon size={14} aria-hidden />
                  {flag.label}
                </button>
              );
            })}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!providerId || !modelId.trim()}
              onClick={() => {
                controller.addCustomModel({ providerId, id: modelId.trim(), name: modelName.trim() || modelId.trim(), ...flags });
                setModelId("");
                setModelName("");
              }}
            >
              <Plus size={14} aria-hidden />
              Add model
            </button>
          </div>
        </div>
        {settings.customModels.length ? (
          <div className="custom-list">
            {settings.customModels.map((entry) => (
              <div key={`${entry.providerId}:${entry.id}`} className="account-row">
                <div className="account-info">
                  <strong>{entry.name}</strong>
                  <span className="meta">
                    {entry.id}
                    {Object.entries(entry).filter(([k]) => ["vision", "tools", "reasoning", "streaming"].includes(k)).map(([k, v]) => v ? ` · ${k}` : "").join("")}
                  </span>
                </div>
                <div className="account-actions">
                  <button
                    type="button"
                    className="icon-btn ghost"
                    aria-label={`Remove ${entry.id}`}
                    onClick={() => {
                      void confirmed(controller, {
                        title: `Remove ${entry.name || entry.id}?`,
                        message: "This model id is deleted from your list. The provider itself stays connected.",
                        confirmLabel: "Remove",
                        tone: "danger",
                      }, () => controller.removeCustomModel(entry.providerId, entry.id));
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="settings-section">
        <h4>Generation</h4>
        <div className="twin">
          <label className="field">
            <span>Temperature override</span>
            <input type="number" min={0} max={2} step={0.1} value={settings.temperature ?? ""} placeholder="Model default" onChange={(event) => controller.updateSettings({ temperature: event.target.value === "" ? null : Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>Max output tokens</span>
            <input type="number" min={1} value={settings.maxTokens ?? ""} placeholder="Model default" onChange={(event) => controller.updateSettings({ maxTokens: event.target.value === "" ? null : Number(event.target.value) })} />
          </label>
        </div>
        <label className="field">
          <span>Max tool rounds per turn</span>
          <input type="number" min={1} max={48} value={settings.maxIterations} onChange={(event) => controller.updateSettings({ maxIterations: Number(event.target.value) || 24 })} />
        </label>
      </section>
    </div>
  );
}

function ModelRow({ model, state, controller }: { model: ModelInfo; state: AppState; controller: AppController }) {
  const key = accountKey(model.accountId, model.id, model.provider);
  const custom = state.settings.customModels.some((item) => item.providerId === model.accountId && item.id === model.id);
  return (
    <div className="model-row">
      <div className="model-row-head">
        <strong>{model.name}</strong>
        <span className="model-id">{model.id}</span>
        {model.contextWindow ? <span className="meta">{Math.round(model.contextWindow / 1000)}k context</span> : null}
      </div>
      <div className="cap-row">
        {FLAGS.map((flag) => {
          const Icon = flag.icon;
          const on = modelAllows(model, state.settings, flag.key);
          return (
            <button
              key={flag.key}
              type="button"
              className={`cap ${on ? "on" : ""}`}
              aria-pressed={on}
              title={`${flag.label}: ${on ? "on" : "off"}. Click to override.`}
              onClick={() => controller.setModelOverride(key, { [flag.key]: !on })}
            >
              <Icon size={13} aria-hidden />
              {flag.label}
            </button>
          );
        })}
        {custom && model.accountId ? (
          <button
            type="button"
            className="icon-btn ghost"
            aria-label={`Remove custom model ${model.id}`}
            onClick={() => {
              void confirmed(controller, {
                title: `Remove ${model.name}?`,
                message: "This model id is deleted from your list. Fetch the catalog again if the provider still serves it.",
                confirmLabel: "Remove",
                tone: "danger",
              }, () => controller.removeCustomModel(model.accountId!, model.id));
            }}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({
  icon: Icon,
  label,
  detail,
  pressed,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  detail: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="toggle" aria-pressed={pressed} onClick={onClick}>
      <span className="toggle-icon"><Icon size={16} aria-hidden /></span>
      <span className="toggle-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
      <span className="switch" aria-hidden><i /></span>
    </button>
  );
}
