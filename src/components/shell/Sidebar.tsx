"use client";

import {
  ChevronDown,
  FolderOpen,
  FolderPlus,
  LogIn,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  PencilLine,
  Plus,
  Settings,
  ShieldQuestion,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Menu } from "@/components/ui/Menu";
import { PERMISSION_MODE_LABEL, type PermissionMode } from "@/lib/permissions/types";
import type { AppState } from "@/lib/app/controller";

export function Sidebar({
  state,
  onNew,
  onSelect,
  onDelete,
  onClose,
  mode,
  onMode,
  onTheme,
  onSettings,
  onConnect,
  onSignIn,
  onSignOut,
  onSwitch,
}: {
  state: AppState;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  mode: PermissionMode;
  onMode: (mode: PermissionMode) => void;
  onTheme: (theme: "light" | "dark" | "system") => void;
  onSettings: () => void;
  onConnect: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSwitch: () => void;
}) {
  const connected = state.workspace.kind !== "none";
  const projectTitle = connected ? state.workspace.label ?? "Project" : "Open a project";
  const projectSub = connected
    ? state.workspace.kind === "bridge"
      ? state.workspace.root ?? state.workspace.label ?? ""
      : "Folder · files only"
    : state.bridge.status === "connected"
      ? "Bridge ready — pick a folder"
      : "No folder connected";
  const initials = (state.auth.user?.username ?? "K")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  const themeIcon = state.settings.theme === "dark" ? Moon : state.settings.theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const ModeIcon = mode === "full" ? Zap : mode === "auto-edit" ? PencilLine : ShieldQuestion;

  return (
    <aside className="sidebar" aria-label="Conversations">
      <div className="brand">
        <div className="mark" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 12.2c0-3.3 2.5-5.7 5.5-5.7s5.5 2.4 5.5 5.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M4.6 12.2h6.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
          </svg>
        </div>
        <div className="brand-text">
          <h1>Kiln</h1>
          <p>Coding agent</p>
        </div>
        <button type="button" className="icon-btn ghost mobile-close" aria-label="Close sidebar" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="side-actions">
        <button
          type="button"
          className={`side-project${connected ? "" : " idle"}`}
          onClick={onConnect}
          title={connected ? `${state.workspace.root ?? state.workspace.label} — change project` : "Open the project the agent should work in"}
        >
          <span className="sp-icon">
            {connected ? <FolderOpen size={15} aria-hidden /> : <FolderPlus size={15} aria-hidden />}
          </span>
          <span className="sp-text">
            <span className="sp-title">{projectTitle}</span>
            <span className="sp-sub">{projectSub}</span>
          </span>
          <ChevronDown size={14} className="chev" aria-hidden />
        </button>
        <button type="button" className="new-chat" onClick={onNew}>
          <Plus size={16} aria-hidden />
          New chat
        </button>
      </div>

      <div className="side-scroll">
        {state.conversations.length === 0 ? (
          <p className="meta" style={{ padding: "6px 10px" }}>
            Your conversations are stored in this browser only.
          </p>
        ) : null}
        {groupedConversations(state).map((group) => (
          <div key={group.label}>
            <div className="section-label">{group.label}</div>
            {group.items.map((conversation) => (
              <div key={conversation.id} className="side-row">
                <button
                  type="button"
                  className={`side-link ${conversation.id === state.activeId ? "active" : ""}`}
                  onClick={() => onSelect(conversation.id)}
                >
                  <MessageSquare size={15} aria-hidden />
                  <span>{conversation.title}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn ghost row-delete"
                  aria-label={`Delete ${conversation.title}`}
                  title={`Delete ${conversation.title}`}
                  onClick={() => onDelete(conversation.id)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="side-footer">
        <Menu
          triggerClassName="account"
          value={mode}
          label={
            <>
              <span className={`avatar${state.auth.status === "signed-in" ? " accent" : ""}`} aria-hidden>
                {initials}
              </span>
              <span className="acct-text">
                <span className="acct-name">
                  {state.auth.status === "signed-in" ? state.auth.user?.username ?? "Puter user" : "Sign in"}
                </span>
                <span className="acct-sub">
                  {PERMISSION_MODE_LABEL[mode]} · {state.settings.theme}
                </span>
              </span>
            </>
          }
          options={[
            { id: "signin", label: state.auth.status === "signed-in" ? "Switch Puter account" : "Sign in with Puter", group: "Account" },
            ...(state.auth.status === "signed-in" ? [{ id: "signout", label: "Sign out", group: "Account" }] : []),
            { id: "mode:ask", label: "Ask Every Time", description: "Approve every mutating action", group: "Permission mode" },
            { id: "mode:auto-edit", label: "Auto-Edit Only", description: "Edit files; ask before shell", group: "Permission mode" },
            { id: "mode:full", label: "Full Access", description: "Keep going; still ask on dangerous commands", group: "Permission mode" },
            { id: "theme:light", label: "Light", group: "Theme" },
            { id: "theme:dark", label: "Dark", group: "Theme" },
            { id: "theme:system", label: "System", group: "Theme" },
            { id: "settings", label: "Settings", group: "App" },
            { id: "connect", label: "Open a project", group: "App" },
          ]}
          onChange={(id) => {
            if (id === "signin") state.auth.status === "signed-in" ? onSwitch() : onSignIn();
            else if (id === "signout") onSignOut();
            else if (id === "settings") onSettings();
            else if (id === "connect") onConnect();
            else if (id.startsWith("mode:")) onMode(id.slice(5) as PermissionMode);
            else if (id.startsWith("theme:")) onTheme(id.slice(6) as "light" | "dark" | "system");
          }}
        />
        <div className="status-row" title={state.bridge.status === "connected" ? `Bridge ${state.bridge.transport}` : "Bridge offline"}>
          <span className={`dot ${connected ? (state.workspace.kind === "bridge" ? "ok" : "warn") : state.bridge.status === "connected" ? "warn" : "bad"}`} />
          <span className="truncate">
            {connected ? `${state.workspace.kind === "bridge" ? "Bridge" : "Files"} · ${state.workspace.label}` : "No project open"}
          </span>
          <ModeIcon size={13} aria-hidden style={{ marginLeft: "auto", flex: "none", opacity: 0.55 }} />
          <ThemeIcon size={13} aria-hidden style={{ flex: "none", opacity: 0.55 }} />
        </div>
      </div>
    </aside>
  );
}

function groupedConversations(state: AppState): { label: string; items: AppState["conversations"] }[] {
  const now = Date.now();
  const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  const buckets = new Map<string, AppState["conversations"]>();
  for (const conversation of state.conversations) {
    const label = bucketLabel(conversation.updatedAt, now);
    const list = buckets.get(label) ?? [];
    list.push(conversation);
    buckets.set(label, list);
  }
  return order.filter((label) => buckets.has(label)).map((label) => ({ label, items: buckets.get(label)! }));
}

function bucketLabel(updatedAt: number, now: number): string {
  const startOfDay = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(updatedAt)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}
