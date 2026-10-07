"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

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
}: {
  label: ReactNode;
  value?: string;
  options: MenuOption[];
  onChange: (id: string) => void;
  searchable?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const filtered = options.filter((option) => {
    const haystack = `${option.label} ${option.description ?? ""} ${option.group ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

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

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
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
          style={{ [align === "right" ? "right" : "left"]: 0, bottom: "calc(100% + 8px)" }}
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
              value={query}
              aria-label="Search options"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
          ) : null}
          {filtered.length === 0 ? <div className="menu-item">No matches</div> : null}
          {filtered.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value || index === active}
              className="menu-item"
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option.id)}
            >
              <span>
                {option.group ? <span className="meta">{option.group}<br /></span> : null}
                {option.label}
                {option.description ? <span className="meta"><br />{option.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
