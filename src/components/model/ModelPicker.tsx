"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Cpu, RefreshCw } from "lucide-react";
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

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={selected ? `${selected.name} (${selected.id})` : "Choose model"}
        onClick={() => setOpen((value) => !value)}
      >
        <Cpu size={14} aria-hidden />
        <span className="chip-label">
          <strong>{selected?.name ?? (state.models.status === "loading" ? "Loading models" : "Choose model")}</strong>
        </span>
        <ChevronDown size={13} className="chev" aria-hidden />
      </button>
      {open ? (
        <div
          className="popover"
          id={listId}
          role="listbox"
          style={{ left: 0, bottom: "calc(100% + 8px)", width: "min(380px, calc(100vw - 48px))" }}
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
          <input
            autoFocus
            placeholder="Search models"
            aria-label="Search models"
            value={state.models.search}
            onChange={(event) => onQuery(event.target.value)}
          />
          <div className="seg" style={{ padding: 6 }}>
            <button type="button" className="chip" aria-pressed={state.models.sort === "name"} onClick={() => onSort("name")}>Name</button>
            <button type="button" className="chip" aria-pressed={state.models.sort === "provider"} onClick={() => onSort("provider")}>Provider</button>
            <button type="button" className="chip" aria-pressed={state.models.sort === "context"} onClick={() => onSort("context")}>Context</button>
            <button type="button" className="chip" onClick={onRefresh} aria-label="Refresh model catalog" title="Refresh model catalog">
              <RefreshCw size={13} aria-hidden />
              <span className="hide-sm">Refresh</span>
            </button>
          </div>
          <div className="seg" style={{ padding: "0 6px 6px" }}>
            <button type="button" className="chip" aria-pressed={state.models.provider === "all"} onClick={() => onProvider("all")}>All</button>
            {state.models.catalog?.providers.slice(0, 8).map((provider) => (
              <button key={provider} type="button" className="chip" aria-pressed={state.models.provider === provider} onClick={() => onProvider(provider)}>
                {provider}
              </button>
            ))}
          </div>
          {state.models.status === "error" ? <p className="meta" style={{ padding: 8 }}>{state.models.error}</p> : null}
          {state.models.status === "idle" ? <p className="meta" style={{ padding: 8 }}>Sign in with Puter to load the live model catalog.</p> : null}
          {state.models.status === "ready" && flat.length === 0 ? (
            <p className="meta" style={{ padding: 8 }}>
              {state.auth.status === "signed-in"
                ? "No models match. The catalog is live — nothing is hardcoded."
                : "The live catalog is empty. Sign in with Puter, then refresh."}
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.provider}>
              <div className="section-label">{group.provider}</div>
              {group.models.map((model) => {
                const index = flat.findIndex((item) => item.id === model.id && item.provider === model.provider);
                return (
                  <button
                    key={`${model.provider}:${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={model.id === selectedId}
                    className="menu-item"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      onSelect(model.id, model.provider);
                      setOpen(false);
                    }}
                  >
                    <span>
                      {model.name}
                      <span className="meta">
                        <br />
                        {model.id}
                        {model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k context` : ""}
                        {model.cost?.input != null ? ` · in ${model.cost.input}` : ""}
                        {model.capabilities.length ? ` · ${model.capabilities.slice(0, 3).join(", ")}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
