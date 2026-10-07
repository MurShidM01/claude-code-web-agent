"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AudioLines, Brain, ChevronDown, Cpu, Eye, RefreshCw, Search, Sparkles, Wrench } from "lucide-react";
import { groupModels, queryModels, type ModelSort } from "@/lib/model/catalog";
import type { AppState } from "@/lib/app/controller";

export function ModelPicker({
  state,
  selectedId,
  onQuery,
  onProvider,
  onSort,
  onSelect,
  onRefresh,
}: {
  state: AppState;
  selectedId: string | null;
  onQuery: (value: string) => void;
  onProvider: (value: string) => void;
  onSort: (value: ModelSort) => void;
  onSelect: (id: string, provider: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const models = useMemo(
    () =>
      state.models.catalog
        ? queryModels(state.models.catalog, {
            search: state.models.search,
            provider: state.models.provider,
            sort: state.models.sort,
          })
        : [],
    [state.models],
  );
  const groups = groupModels(models);
  const flat = groups.flatMap((group) => group.models);
  const selected = state.models.catalog?.models.find((model) => model.id === selectedId);
  const providers = state.models.catalog?.providers ?? [];
  const modelCount = state.models.catalog?.models.length ?? 0;

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  useEffect(() => {
    const openPicker = () => setOpen(true);
    window.addEventListener("kiln:open-model", openPicker);
    return () => window.removeEventListener("kiln:open-model", openPicker);
  }, []);

  const loading = state.models.status === "loading" || state.models.status === "idle";

  return (
    <div ref={root} style={{ position: "relative" }} className="model-picker">
      <button
        type="button"
        className="model-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={selected ? `${selected.name} (${selected.id})` : "Choose model"}
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu size={14} aria-hidden />
        <span className="model-picker-label">
          {selected ? (
            <>
              <strong>{selected.name}</strong>
              <span>{selected.provider}</span>
            </>
          ) : loading ? (
            <>
              <strong>Loading models…</strong>
              <span>Fetching the live catalog</span>
            </>
          ) : (
            <>
              <strong>{modelCount ? "Choose model" : "No models yet"}</strong>
              <span>{modelCount ? `${modelCount} available` : "Connect a provider"}</span>
            </>
          )}
        </span>
        <ChevronDown size={13} className="chev" aria-hidden />
      </button>
      {open ? (
        <div
          className="popover model-popover"
          id={listId}
          role="listbox"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") setActive((index) => Math.min(flat.length - 1, index + 1));
            if (event.key === "ArrowUp") setActive((index) => Math.max(0, index - 1));
            if (event.key === "Enter" && flat[active]) {
              onSelect(flat[active]!.id, flat[active]!.provider);
              setOpen(false);
            }
          }}
        >
          <div className="model-popover-head">
            <div className="model-popover-search">
              <Search size={14} aria-hidden />
              <input
                autoFocus
                placeholder="Search models"
                aria-label="Search models"
                value={state.models.search}
                onChange={(event) => onQuery(event.target.value)}
              />
            </div>
            <button type="button" className="icon-btn ghost" onClick={onRefresh} aria-label="Refresh model catalog" title="Refresh model catalog">
              <RefreshCw size={14} aria-hidden />
            </button>
          </div>

          <div className="model-popover-tabs" role="tablist" aria-label="Sort and filter">
            <div className="seg">
              <button type="button" className="seg-btn" aria-pressed={state.models.sort === "name"} onClick={() => onSort("name")}>Name</button>
              <button type="button" className="seg-btn" aria-pressed={state.models.sort === "provider"} onClick={() => onSort("provider")}>Provider</button>
              <button type="button" className="seg-btn" aria-pressed={state.models.sort === "context"} onClick={() => onSort("context")}>Context</button>
            </div>
            <div className="seg seg-scroll">
              <button type="button" className="seg-btn" aria-pressed={state.models.provider === "all"} onClick={() => onProvider("all")}>All</button>
              {providers.slice(0, 12).map((provider) => (
                <button key={provider} type="button" className="seg-btn" aria-pressed={state.models.provider === provider} onClick={() => onProvider(provider)}>
                  {provider}
                </button>
              ))}
            </div>
          </div>

          <div className="model-popover-body">
            {state.models.status === "error" ? <p className="meta error">{state.models.error}</p> : null}
            {state.models.status === "idle" ? <p className="meta">Connect a provider in Settings to load models. Nothing is hardcoded.</p> : null}
            {state.models.status === "ready" && flat.length === 0 ? (
              <p className="meta">
                {state.auth.status === "signed-in"
                  ? "No models match. The catalog is live — nothing is hardcoded."
                  : "The live catalog is empty. Connect a provider in Settings, then refresh."}
              </p>
            ) : null}
            {groups.map((group) => (
              <div key={group.provider} className="model-popover-group">
                <div className="model-popover-group-head">
                  <strong>{group.provider}</strong>
                  <span className="meta">{group.models.length}</span>
                </div>
                {group.models.map((model) => {
                  const index = flat.findIndex((item) => item.id === model.id && item.provider === model.provider);
                  return (
                    <button
                      key={`${model.provider}:${model.id}`}
                      type="button"
                      role="option"
                      aria-selected={model.id === selectedId}
                      className={`model-popover-item${index === active ? " active" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        onSelect(model.id, model.provider);
                        setOpen(false);
                      }}
                    >
                      <span className="model-popover-item-main">
                        <strong>{model.name}</strong>
                        <span className="model-popover-item-id">{model.id}</span>
                      </span>
                      <span className="model-popover-item-meta">
                        {model.contextWindow ? <span className="meta">{Math.round(model.contextWindow / 1000)}k ctx</span> : null}
                        <span className="cap-inline" aria-hidden>
                          {model.capabilities.some((cap) => /vision/i.test(cap)) ? <Eye size={11} /> : null}
                          {model.capabilities.some((cap) => /tool|function/i.test(cap)) ? <Wrench size={11} /> : null}
                          {model.capabilities.some((cap) => /reason/i.test(cap)) ? <Brain size={11} /> : null}
                          {model.capabilities.some((cap) => /stream/i.test(cap)) ? <AudioLines size={11} /> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
