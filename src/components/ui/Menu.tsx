"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";

export interface MenuOption {
  id: string;
  label: string;
  description?: string;
  group?: string;
}

export function Menu({
  label,
  value,
  options,
  onChange,
  searchable = false,
  align = "left",
  direction = "up",
  triggerClassName = "chip",
  triggerTitle,
}: {
  label: ReactNode;
  value?: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  searchable?: boolean;
  align?: "left" | "right";
  /** Which way the popover grows from the trigger. */
  direction?: "up" | "down";
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return options.filter((option) => `${option.label} ${option.description ?? ""} ${option.group ?? ""}`.toLowerCase().includes(needle));
  }, [options, query]);
  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, MenuOption[]>();
    for (const option of filtered) {
      const key = option.group ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(option);
    }
    return order.map((key) => ({ group: key, options: map.get(key)! }));
  }, [filtered]);
  const showGroups = grouped.length > 1 || (grouped.length === 1 && grouped[0]!.group !== "");

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  const position: CSSProperties = {
    [align === "right" ? "right" : "left"]: 0,
    ...(direction === "up" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
  };

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        className={triggerClassName}
        title={triggerTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open ? (
        <div
          className="popover"
          id={listId}
          role="listbox"
          style={position}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(filtered.length - 1, index + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter" && filtered[active]) choose(filtered[active]!.id);
          }}
        >
          {searchable ? (
            <input
              autoFocus
              placeholder="Search"
              aria-label="Search options"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}
          {filtered.length === 0 ? <div className="menu-item">No matches</div> : null}
          {grouped.map((section) => (
            <div key={section.group || "_"}>
              {showGroups && section.group ? <div className="section-label">{section.group}</div> : null}
              {section.options.map((option) => {
                const index = filtered.findIndex((item) => item.id === option.id);
                const selected = option.id === value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="menu-item"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.id)}
                  >
                    <span>
                      {option.label}
                      {option.description ? (
                        <span className="meta">
                          <br />
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? <Check size={14} aria-hidden style={{ marginLeft: "auto", flex: "none", color: "var(--accent)" }} /> : null}
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
