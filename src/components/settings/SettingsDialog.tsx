"use client";

import {
  AudioLines,
  Cable,
  Keyboard,
  KeyRound,
  Palette,
  ScrollText,
  Shield,
  ShieldAlert,
  Sun,
  Moon,
  Monitor,
  X,
  type LucideIcon,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { ModelToolsPanel } from "@/components/settings/ModelToolsPanel";
import { ProviderPanel } from "@/components/settings/ProviderPanel";
import type { AppController, AppState } from "@/lib/app/controller";
import type { PermissionMode } from "@/lib/permissions/types";
import type { SettingsTab, ThemePreference } from "@/lib/persistence/settings";

const SHORTCUTS: [string, string][] = [
  ["Enter", "Send the message"],
  ["Shift + Enter", "New line"],
  ["Esc", "Stop the running turn"],
  ["⌘/Ctrl + O", "Open a project"],
  ["⌘/Ctrl + B", "Toggle the sidebar"],
  ["⌘/Ctrl + K", "Command palette"],
  ["⌘/Ctrl + \\", "Toggle the file panel"],
  ["⌘/Ctrl + Shift + M", "Switch model"],
  ["⌘/Ctrl + ,", "Settings"],
];

const NAV: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "models", label: "Models & tools", icon: AudioLines },
  { id: "permissions", label: "Permissions", icon: Shield },
  { id: "bridge", label: "Bridge", icon: Cable },
  { id: "safety", label: "Safety", icon: ShieldAlert },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "diagnostics", label: "Diagnostics", icon: ScrollText },
];

const THEMES: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function SettingsDialog({ state, controller }: { state: AppState; controller: AppController }) {
  const tab = state.settingsTab;
  return (
    <Dialog open={state.settingsOpen} title="Settings" layout="settings" onClose={() => controller.setSettingsOpen(false)}>
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-brand">
            <div>
              <strong>Settings</strong>
              <span>Stored in this browser</span>
            </div>
            <button type="button" className="icon-btn ghost" aria-label="Close settings" onClick={() => controller.setSettingsOpen(false)}>
              <X size={16} aria-hidden />
            </button>
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className="settings-link" aria-current={tab === item.id ? "page" : undefined} onClick={() => controller.setSettingsTab(item.id)}>
                <Icon size={16} aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="settings-main">
          {tab === "appearance" ? <Appearance state={state} controller={controller} /> : null}
          {tab === "providers" ? <ProviderPanel state={state} controller={controller} /> : null}
          {tab === "models" ? <ModelToolsPanel state={state} controller={controller} /> : null}
          {tab === "permissions" ? <Permissions state={state} controller={controller} /> : null}
          {tab === "bridge" ? <Bridge state={state} controller={controller} /> : null}
          {tab === "safety" ? <Safety state={state} controller={controller} /> : null}
          {tab === "shortcuts" ? <Shortcuts /> : null}
          {tab === "diagnostics" ? <Diagnostics state={state} /> : null}
          <div className="dialog-actions">
            <button type="button" className="btn primary" onClick={() => controller.setSettingsOpen(false)}>Done</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Appearance({ state, controller }: { state: AppState; controller: AppController }) {
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Appearance</h3>
        <p>The canvas follows the theme. System tracks the operating system.</p>
      </header>
      <div className="theme-grid">
        {THEMES.map((theme) => {
          const Icon = theme.icon;
          return (
            <button key={theme.id} type="button" className="theme-card" aria-pressed={state.settings.theme === theme.id} onClick={() => controller.setTheme(theme.id)}>
              <Icon size={18} aria-hidden />
              <strong>{theme.label}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Permissions({ state, controller }: { state: AppState; controller: AppController }) {
  const modes: [PermissionMode, string, string][] = [
    ["ask", "Ask every time", "Approval before mutating or privileged tools"],
    ["auto-edit", "Auto-edit only", "File edits proceed. Shell and network still ask"],
    ["full", "Full access", "The loop continues. Dangerous commands still ask"],
  ];
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Permissions</h3>
        <p>Applied to new conversations. Enforcement happens in the tool layer, before a tool runs.</p>
      </header>
      <div className="choice-list">
        {modes.map(([mode, label, detail]) => (
          <button key={mode} type="button" className="choice" aria-pressed={state.settings.defaultPermissionMode === mode} onClick={() => controller.updateSettings({ defaultPermissionMode: mode })}>
            <strong>{label}</strong>
            <span>{detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Bridge({ state, controller }: { state: AppState; controller: AppController }) {
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Local bridge</h3>
        <p>Used when you pair a bridge on another machine. Local mode reads <code>.kiln/bridge.json</code> instead. Provider sign-in also uses the bridge so tokens stay on this computer.</p>
      </header>
      <div className="twin">
        <label className="field">
          <span>Host</span>
          <input value={state.settings.bridgeHost} spellCheck={false} onChange={(event) => controller.updateSettings({ bridgeHost: event.target.value })} />
        </label>
        <label className="field">
          <span>Port</span>
          <input type="number" value={state.settings.bridgePort} onChange={(event) => controller.updateSettings({ bridgePort: Number(event.target.value) || 3939 })} />
        </label>
      </div>
      <p className="meta">Bridge is {state.bridge.status}{state.bridge.transport !== "none" ? ` · ${state.bridge.transport}` : ""}.</p>
    </div>
  );
}

function Safety({ state, controller }: { state: AppState; controller: AppController }) {
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Command safety</h3>
        <p>Extra deny patterns are checked before a command is spawned. One regex or substring per line.</p>
      </header>
      <label className="field">
        <span>Deny patterns</span>
        <textarea
          rows={5}
          value={state.settings.extraDenyPatterns.join("\n")}
          placeholder={"rm -rf /\ngit push --force"}
          onChange={(event) =>
            controller.updateSettings({
              extraDenyPatterns: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={state.settings.persistenceEnabled} onChange={(event) => controller.updateSettings({ persistenceEnabled: event.target.checked })} />
        <span>Keep conversations in this browser (IndexedDB)</span>
      </label>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Shortcuts</h3>
        <p>Reasoning, streaming, vision, and tools also have icons in the composer.</p>
      </header>
      <div className="shortcut-list">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <kbd>{keys}</kbd>
            <span>{action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Diagnostics({ state }: { state: AppState }) {
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Diagnostics</h3>
        <p>Recent local log lines. File contents and tokens are not written here.</p>
      </header>
      <div className="terminal">
        {state.logs.length ? state.logs.slice(-12).map((entry) => `${entry.level}: ${entry.message}`).join("\n") : "Nothing logged yet."}
      </div>
    </div>
  );
}
