"use client";

import { useMemo, useState } from "react";
import { AudioLines, Brain, Eye, Plus, RefreshCw, Trash2, Wrench } from "lucide-react";
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
  const models = useMemo(() => {
    const list = state.models.catalog?.models ?? [];
    const needle = query.trim().toLowerCase();
    return needle ? list.filter((model) => `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(needle)) : list;
  }, [query, state.models.catalog]);

  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Models and tools</h3>
        <p>Global switches apply to the next turn. A model toggle overrides what that model reported. Unknown vision and reasoning stay off until the provider says so, or you turn them on.</p>
      </header>

      <div className="toggle-grid">
        <Toggle icon={Brain} label="Reasoning" detail="Composer brain icon. Off sends no thinking parameters." pressed={settings.reasoningEnabled} onClick={() => controller.setReasoningEnabled(!settings.reasoningEnabled)} />
        <Toggle icon={AudioLines} label="Streaming" detail="Off waits for the full response, then shows it." pressed={settings.streamingEnabled} onClick={() => controller.setStreamingEnabled(!settings.streamingEnabled)} />
        <Toggle icon={Eye} label="Vision" detail="Attach images only when the model can see them." pressed={settings.visionEnabled} onClick={() => controller.setVisionEnabled(!settings.visionEnabled)} />
        <Toggle icon={Wrench} label="Tool calling" detail="Off hides every tool schema from the model." pressed={settings.toolsEnabled} onClick={() => controller.setToolsEnabled(!settings.toolsEnabled)} />
      </div>

      <div className="dialog-section">
        <div className="section-label">Live catalog</div>
        <div className="catalog-bar">
          <input value={query} placeholder="Filter fetched models" aria-label="Filter models" onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="btn" onClick={() => void controller.refreshModels()}>
            <RefreshCw size={14} aria-hidden />
            Fetch
          </button>
        </div>
        {state.models.status === "error" ? <p className="meta">{state.models.error}</p> : null}
        {state.models.status === "loading" ? <p className="meta">Fetching models…</p> : null}
        {!models.length && state.models.status !== "loading" ? (
          <p className="meta">No models yet. Connect a provider, or add an id below. Kiln will not invent one.</p>
        ) : null}
        <div className="model-cap-list">
          {models.slice(0, 40).map((model) => (
            <ModelRow key={`${model.provider}:${model.accountId ?? ""}:${model.id}`} model={model} state={state} controller={controller} />
          ))}
        </div>
        {models.length > 40 ? <p className="meta">Showing 40 of {models.length}. Filter to narrow.</p> : null}
      </div>

      <div className="dialog-section">
        <div className="section-label">Add a model by id</div>
        <div className="provider-form">
          <label className="field">
            <span>Provider</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              <option value="">Choose a connected provider</option>
              {settings.providers.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model id</span>
            <input value={modelId} placeholder="Exactly the id the provider expects" spellCheck={false} onChange={(event) => setModelId(event.target.value)} />
          </label>
          <label className="field">
            <span>Display name</span>
            <input value={modelName} placeholder="Optional" onChange={(event) => setModelName(event.target.value)} />
          </label>
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
          <div className="provider-actions">
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
          <div className="model-cap-list">
            {settings.customModels.map((entry) => (
              <div key={`${entry.providerId}:${entry.id}`} className="account-row">
                <div>
                  <strong>{entry.name}</strong>
                  <span className="meta">{entry.id}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
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
            ))}
          </div>
        ) : null}
      </div>

      <div className="dialog-section">
        <div className="section-label">Generation</div>
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
      </div>
    </div>
  );
}

function ModelRow({ model, state, controller }: { model: ModelInfo; state: AppState; controller: AppController }) {
  const key = accountKey(model.accountId, model.id, model.provider);
  const custom = state.settings.customModels.some((item) => item.providerId === model.accountId && item.id === model.id);
  return (
    <div className="model-cap">
      <div className="model-cap-name">
        <strong>{model.name}</strong>
        <span className="meta">{model.provider} · {model.id}{model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : ""}</span>
      </div>
      <div className="cap-row">
        {FLAGS.map((flag) => {
          const Icon = flag.icon;
          const on = modelAllows(model, state.settings, flag.key);
          return (
            <button
              key={flag.key}
              type="button"
              className="cap"
              aria-pressed={on}
              title={`${flag.label}: ${on ? "on" : "off"}. Click to override.`}
              onClick={() => controller.setModelOverride(key, { [flag.key]: !on })}
            >
              <Icon size={13} aria-hidden />
              <span className="hide-sm">{flag.label}</span>
            </button>
          );
        })}
        {custom && model.accountId ? (
          <button
            type="button"
            className="icon-btn"
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
