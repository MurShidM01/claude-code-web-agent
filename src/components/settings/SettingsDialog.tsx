"use client";

import { Dialog } from "@/components/ui/Dialog";
import type { AppController, AppState } from "@/lib/app/controller";
import type { PermissionMode } from "@/lib/permissions/types";
import type { ThemePreference } from "@/lib/persistence/settings";

export function SettingsDialog({ state, controller }: { state: AppState; controller: AppController }) {
  const settings = state.settings;
  return (
    <Dialog open={state.settingsOpen} title="Settings" onClose={() => controller.setSettingsOpen(false)}>
      <div className="field">
        <label>Theme</label>
        <div className="seg">
          {(["light", "dark", "system"] as ThemePreference[]).map((theme) => (
            <button key={theme} type="button" className="chip" aria-pressed={settings.theme === theme} onClick={() => controller.setTheme(theme)}>
              {theme}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Default permission mode</label>
        <div className="seg">
          {(["ask", "auto-edit", "full"] as PermissionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className="chip"
              aria-pressed={settings.defaultPermissionMode === mode}
              onClick={() => controller.updateSettings({ defaultPermissionMode: mode })}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Temperature override
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
      <label className="field">
        Max output tokens
        <input
          type="number"
          min={1}
          value={settings.maxTokens ?? ""}
          placeholder="Model default"
          onChange={(event) => controller.updateSettings({ maxTokens: event.target.value === "" ? null : Number(event.target.value) })}
        />
      </label>
      <label className="field">
        Max tool rounds
        <input
          type="number"
          min={1}
          max={48}
          value={settings.maxIterations}
          onChange={(event) => controller.updateSettings({ maxIterations: Number(event.target.value) || 24 })}
        />
      </label>
      <label className="field">
        Extra deny patterns
        <textarea
          rows={3}
          value={settings.extraDenyPatterns.join("\n")}
          placeholder="One regex or substring per line"
          onChange={(event) =>
            controller.updateSettings({
              extraDenyPatterns: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
            })
          }
        />
      </label>
      <label className="field">
        Bridge host
        <input value={settings.bridgeHost} onChange={(event) => controller.updateSettings({ bridgeHost: event.target.value })} />
      </label>
      <label className="field">
        Bridge port
        <input type="number" value={settings.bridgePort} onChange={(event) => controller.updateSettings({ bridgePort: Number(event.target.value) || 3939 })} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.persistenceEnabled}
          onChange={(event) => controller.updateSettings({ persistenceEnabled: event.target.checked })}
        />
        <span>Keep conversations in this browser</span>
      </label>
      <div className="card-body">
        <div className="section-label">Recent log</div>
        {state.logs.slice(-6).map((entry, index) => (
          <div key={`${entry.at}-${index}`} className="meta">
            {entry.level}: {entry.message}
          </div>
        ))}
        <p className="meta">Kiln does not send file contents or tokens to this log.</p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn primary" onClick={() => controller.setSettingsOpen(false)}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
