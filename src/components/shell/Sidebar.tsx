"use client";

import { FolderOpen, Moon, Plus, Settings, Sun } from "lucide-react";
import { Menu } from "@/components/ui/Menu";
import { PERMISSION_MODE_LABEL, type PermissionMode } from "@/lib/permissions/types";
import type { AppState } from "@/lib/app/controller";

export function Sidebar({
  state,
  onNew,
  onSelect,
  onDelete,
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
  mode: PermissionMode;
  onMode: (mode: PermissionMode) => void;
  onTheme: (theme: "light" | "dark" | "system") => void;
  onSettings: () => void;
  onConnect: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSwitch: () => void;
}) {
  const bridgeLabel =
    state.bridge.status === "connected"
      ? state.workspace.kind === "bridge"
        ? `Bridge · ${state.workspace.label}`
        : "Bridge online"
      : state.workspace.kind === "fsa"
        ? `Files · ${state.workspace.label}`
        : "Bridge offline";
  return (
    <aside className="sidebar" aria-label="Conversations">
      <div className="brand">
        <div className="mark" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 12c0-3.2 2.4-5.5 6-5.5S14 8.8 14 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4.5 12h7" stroke="#E7A27C" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1>Kiln</h1>
          <p>Coding agent</p>
        </div>
      </div>
      <div style={{ padding: "4px 12px 8px" }}>
        <button type="button" className="quiet-btn" onClick={onNew}>
          <Plus size={16} aria-hidden />
          New conversation
        </button>
      </div>
      <div className="side-scroll">
        <div className="section-label">Recent</div>
        {state.conversations.length === 0 ? <div className="meta" style={{ padding: "0 10px" }}>No conversations yet.</div> : null}
        {state.conversations.map((conversation) => (
          <div key={conversation.id} style={{ display: "flex" }}>
            <button
              type="button"
              className={`side-link ${conversation.id === state.activeId ? "active" : ""}`}
              onClick={() => onSelect(conversation.id)}
            >
              <span>{conversation.title}</span>
            </button>
            <button type="button" className="icon-btn" aria-label={`Delete ${conversation.title}`} onClick={() => onDelete(conversation.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="side-footer">
        <button type="button" className="quiet-btn" onClick={onConnect}>
          <FolderOpen size={16} aria-hidden />
          <span className={`dot ${state.bridge.status === "connected" ? "ok" : state.workspace.kind === "fsa" ? "warn" : "bad"}`} />
          {bridgeLabel}
        </button>
        <Menu
          label={<>Mode · <strong>{PERMISSION_MODE_LABEL[mode]}</strong></>}
          value={mode}
          options={[
            { id: "ask", label: "Ask Every Time", description: "Approve every mutating or privileged action" },
            { id: "auto-edit", label: "Auto-Edit Only", description: "Edit files freely; ask before shell and other privileged work" },
            { id: "full", label: "Full Access", description: "Continue the loop; still ask for dangerous commands" },
          ]}
          onChange={(id) => onMode(id as PermissionMode)}
        />
        <Menu
          label={<>{state.settings.theme === "dark" ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />} Theme · <strong>{state.settings.theme}</strong></>}
          value={state.settings.theme}
          options={[
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
            { id: "system", label: "System" },
          ]}
          onChange={(id) => onTheme(id as "light" | "dark" | "system")}
        />
        <button type="button" className="quiet-btn" onClick={onSettings}>
          <Settings size={16} aria-hidden />
          Settings
        </button>
        {state.auth.status === "signed-in" ? (
          <>
            <div className="status-row">Signed in as {state.auth.user?.username ?? "Puter user"}</div>
            <button type="button" className="quiet-btn" onClick={onSwitch}>Switch account</button>
            <button type="button" className="quiet-btn" onClick={onSignOut}>Sign out</button>
          </>
        ) : (
          <button type="button" className="quiet-btn" onClick={onSignIn} disabled={state.auth.status === "signing-in"}>
            {state.auth.status === "signing-in" ? "Waiting for Puter…" : state.auth.status === "checking" ? "Checking session…" : "Sign in with Puter"}
          </button>
        )}
      </div>
    </aside>
  );
}

