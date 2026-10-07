"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AppController, AppState } from "@/lib/app/controller";

export function CommandPalette({ state, controller }: { state: AppState; controller: AppController }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    const actions = [
      { id: "new", label: "New conversation", run: () => controller.newConversation() },
      { id: "connect", label: "Open project", detail: "Choose the folder the agent works in", run: () => controller.setConnectionOpen(true) },
      ...(state.workspace.kind !== "none"
        ? [{ id: "close-project", label: "Close project", detail: state.workspace.label ?? "", run: () => controller.closeWorkspace() }]
        : []),
      ...state.workspaces.map((workspace) => ({
        id: `ws:${workspace.id}`,
        label: workspace.label,
        detail: `${workspace.kind === "fsa" ? "Folder" : "Bridge"} · ${workspace.root ?? ""}`,
        run: () => void controller.openWorkspace(workspace.id),
      })),
      { id: "settings", label: "Open settings", run: () => controller.setSettingsOpen(true) },
      { id: "sidebar", label: "Toggle sidebar", run: () => controller.toggleSidebar() },
      { id: "explorer", label: "Toggle file panel", run: () => controller.toggleExplorer() },
      { id: "models", label: "Switch model", run: () => window.dispatchEvent(new Event("kiln:open-model")) },
      ...state.catalog.commands.map((command) => ({
        id: `cmd:${command.name}`,
        label: `/${command.name}`,
        detail: command.description,
        run: () => window.dispatchEvent(new CustomEvent("kiln:fill", { detail: `/${command.name} ` })),
      })),
      ...state.conversations.map((conversation) => ({
        id: `conv:${conversation.id}`,
        label: conversation.title,
        detail: "Conversation",
        run: () => controller.selectConversation(conversation.id),
      })),
    ];
    const needle = query.toLowerCase();
    return actions.filter((item) => `${item.label} ${"detail" in item ? item.detail : ""}`.toLowerCase().includes(needle));
  }, [controller, query, state.catalog.commands, state.conversations, state.workspaces, state.workspace.kind, state.workspace.label]);

  useEffect(() => setActive(0), [query, state.paletteOpen]);
  if (!state.paletteOpen) return null;
  return (
    <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && controller.setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={16} aria-hidden />
          <input
            autoFocus
            placeholder="Search commands and conversations"
            aria-label="Search commands and conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") controller.setPalette(false);
              if (event.key === "ArrowDown") setActive((index) => Math.min(items.length - 1, index + 1));
              if (event.key === "ArrowUp") setActive((index) => Math.max(0, index - 1));
              if (event.key === "Enter" && items[active]) {
                items[active]!.run();
                controller.setPalette(false);
              }
            }}
          />
        </div>
        <div style={{ maxHeight: 360, overflow: "auto", padding: 6 }}>
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="menu-item"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                item.run();
                controller.setPalette(false);
              }}
            >
              <span>
                {item.label}
                {"detail" in item && item.detail ? <span className="meta"><br />{item.detail}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
