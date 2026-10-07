"use client";

import { Dialog } from "@/components/ui/Dialog";
import type { AppController, AppState } from "@/lib/app/controller";
import type { PermissionMode } from "@/lib/permissions/types";
import type { ThemePreference } from "@/lib/persistence/settings";

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

export function SettingsDialog({ state, controller }: { state: AppState; controller: AppController }) {
  const settings = state.settings;
  return (
    <Dialog open={state.settingsOpen} title="Settings" onClose={() => controller.setSettingsOpen(false)}>
      <p className="dialog-sub">Preferences are stored in this browser. Model calls still go through your Puter account.</p>

      <div className="dialog-section">
        <div className="section-label">Appearance</div>
        <div className="seg">
          {(["light", "dark", "system"] as ThemePreference[]).map((theme) => (
            <button key={theme} type="button" className="chip" aria-pressed={settings.theme === theme} onClick={() => controller.setTheme(theme)}>
              {theme}
            </button>
          ))}
        </div>
      </div>

      <div className="dialog-section">
        <div className="section-label">Default permission mode</div>
        <div className="seg">
          {([
            ["ask", "Ask Every Time"],
            ["auto-edit", "Auto-Edit Only"],
            ["full", "Full Access"],
          ] as [PermissionMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="chip"
              aria-pressed={settings.defaultPermissionMode === mode}
              onClick={() => controller.updateSettings({ defaultPermissionMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="meta" style={{ margin: "8px 0 0" }}>
          Applied to new conversations. The mode is enforced in the tool layer before a tool runs, not in the buttons.
        </p>
      </div>

      <div className="dialog-section">
        <div className="section-label">Model defaults</div>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Temperature override</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature ?? ""}
              placeholder="Model default"
              onChange={(event) => controller.updateSettings({ temperature: event.target.value === "" ? null : Number(event.target.value) })}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Max output tokens</span>
            <input
              type="number"
              min={1}
              value={settings.maxTokens ?? ""}
              placeholder="Model default"
              onChange={(event) => controller.updateSettings({ maxTokens: event.target.value === "" ? null : Number(event.target.value) })}
            />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Max tool rounds per turn</span>
            <input
              type="number"
              min={1}
              max={48}
              value={settings.maxIterations}
              onChange={(event) => controller.updateSettings({ maxIterations: Number(event.target.value) || 24 })}
            />
          </label>
        </div>
      </div>

      <div className="dialog-section">
        <div className="section-label">Local bridge</div>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Host</span>
            <input value={settings.bridgeHost} spellCheck={false} onChange={(event) => controller.updateSettings({ bridgeHost: event.target.value })} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Port</span>
            <input
              type="number"
              value={settings.bridgePort}
              onChange={(event) => controller.updateSettings({ bridgePort: Number(event.target.value) || 3939 })}
            />
          </label>
        </div>
        <p className="meta" style={{ margin: "8px 0 0" }}>
          Used when you pair a bridge on another machine. Local mode reads <code>.kiln/bridge.json</code> instead.
        </p>
      </div>

      <div className="dialog-section">
        <div className="section-label">Command safety</div>
        <label className="field" style={{ margin: 0 }}>
          <span>Extra deny patterns — one regex or substring per line</span>
          <textarea
            rows={3}
            value={settings.extraDenyPatterns.join("\n")}
            placeholder={"rm -rf /\ngit push --force"}
            onChange={(event) =>
              controller.updateSettings({
                extraDenyPatterns: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.persistenceEnabled}
          onChange={(event) => controller.updateSettings({ persistenceEnabled: event.target.checked })}
        />
        <span>Keep conversations in this browser (IndexedDB)</span>
      </label>

      <div className="dialog-section">
        <div className="section-label">Shortcuts</div>
        <div className="kv" style={{ margin: 0 }}>
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <kbd style={{ flex: "none", minWidth: 118, textAlign: "center" }}>{keys}</kbd>
              <span className="meta">{action}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dialog-section">
        <div className="section-label">Recent log</div>
        <div className="terminal" style={{ maxHeight: 140 }}>
          {state.logs.length
            ? state.logs
                .slice(-8)
                .map((entry) => `${entry.level}: ${entry.message}`)
                .join("\n")
            : "Nothing logged yet."}
        </div>
        <p className="meta" style={{ margin: "8px 0 0" }}>
          Kiln does not send file contents or tokens to this log.
        </p>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn primary" onClick={() => controller.setSettingsOpen(false)}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
