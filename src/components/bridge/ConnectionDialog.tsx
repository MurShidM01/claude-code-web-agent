"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Folder, FolderInput, FolderOpen, Link2, Plug, RefreshCw, Terminal, X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import type { AppController, AppState } from "@/lib/app/controller";

export function ConnectionDialog({ state, controller }: { state: AppState; controller: AppController }) {
  const [root, setRoot] = useState(state.bridge.health?.suggestedRoot ?? state.bridge.health?.workspace?.root ?? "");
  const [code, setCode] = useState("");
  useEffect(() => {
    const suggested = state.bridge.health?.suggestedRoot ?? state.bridge.health?.workspace?.root;
    if (suggested) setRoot((current) => current || suggested);
  }, [state.bridge.health?.suggestedRoot, state.bridge.health?.workspace?.root]);

  const bridgeUp = state.bridge.status === "connected";
  const connected = state.workspace.kind !== "none";

  return (
    <Dialog open={state.connectionOpen} title="Open a project" wide onClose={() => controller.setConnectionOpen(false)}>
      <p className="dialog-sub">
        Kiln reads, edits, and runs commands inside one project folder. Choose the folder this agent should work in — the chat
        works either way, but no file or command tool runs until a project is open.
      </p>

      {connected ? (
        <div className="dialog-section">
          <div className="section-label">Current project</div>
          <div className="ws-list">
            <div className="ws-row active" style={{ cursor: "default" }}>
              <span className="ws-icon">
                <FolderOpen size={16} aria-hidden />
              </span>
              <span className="ws-text">
                <span className="ws-name">{state.workspace.label}</span>
                <span className="ws-path">{state.workspace.root}</span>
              </span>
              <span className="badge info">{state.workspace.kind === "bridge" ? "full access" : "files only"}</span>
              <button
                type="button"
                className="icon-btn ghost"
                aria-label="Close project"
                title="Close project"
                onClick={() => controller.closeWorkspace()}
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {state.workspaces.length ? (
        <div className="dialog-section">
          <div className="section-label">Recent projects</div>
          <div className="ws-list">
            {state.workspaces.map((workspace) => {
              const isCurrent = workspace.id === state.workspace.id;
              const needsBridge = workspace.kind === "bridge" && !bridgeUp;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={`ws-row${isCurrent ? " active" : ""}`}
                  disabled={isCurrent || needsBridge}
                  title={needsBridge ? "The local bridge is offline, so this path cannot be opened" : workspace.root ?? workspace.label}
                  onClick={() => void controller.openWorkspace(workspace.id)}
                >
                  <span className="ws-icon">
                    {workspace.kind === "fsa" ? <Folder size={16} aria-hidden /> : <Terminal size={16} aria-hidden />}
                  </span>
                  <span className="ws-text">
                    <span className="ws-name">{workspace.label}</span>
                    <span className="ws-path">{workspace.root}</span>
                  </span>
                  {isCurrent ? (
                    <span className="badge ok">open</span>
                  ) : (
                    <span className="ws-go">{needsBridge ? <span className="meta">bridge offline</span> : <ArrowRight size={16} aria-hidden />}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="dialog-section">
        <div className="section-label">Open something else</div>
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" className="btn primary block" onClick={() => void controller.pickFolder()} disabled={!state.fsaSupported}>
            <FolderInput size={16} aria-hidden />
            {state.fsaSupported ? "Choose a folder on this computer" : "Folder picker needs a Chromium browser"}
          </button>
          <p className="meta" style={{ margin: 0 }}>
            Uses the File System Access API for reads and writes. Shell, git, and long-running processes still need the bridge
            below.
          </p>
        </div>
      </div>

      <div className="dialog-section">
        <div className="section-label">Open by path</div>
        <label className="field">
          <span>Absolute path to the project</span>
          <input
            data-autofocus
            value={root}
            placeholder="/path/to/project"
            spellCheck={false}
            onChange={(event) => setRoot(event.target.value)}
          />
        </label>
        <div className="dialog-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => void controller.refreshBridge()}>
            <RefreshCw size={15} aria-hidden />
            Recheck bridge
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void controller.selectBridgeWorkspace(root)}
            disabled={!root.trim() || !bridgeUp}
          >
            <FolderOpen size={15} aria-hidden />
            Open path
          </button>
        </div>
        <div className="status-row" style={{ marginTop: 8 }}>
          <span className={`dot ${bridgeUp ? "ok" : "bad"}`} />
          <span className="truncate">
            {bridgeUp
              ? `Bridge connected via ${state.bridge.transport} — paths on this machine open with shell and git access`
              : state.bridge.error || "Bridge offline. Run npm run bridge, or pair the code below."}
          </span>
        </div>
      </div>

      <div className="dialog-section">
        <div className="section-label">Pair a bridge on another machine</div>
        <label className="field">
          <span>Pairing code printed when the bridge starts</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 characters from the bridge terminal" spellCheck={false} />
        </label>
        <div className="dialog-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => void controller.pairDirect(code)} disabled={!code.trim()}>
            <Link2 size={15} aria-hidden />
            Pair this browser
          </button>
        </div>
        <p className="meta" style={{ margin: "8px 0 0" }}>
          <Plug size={12} aria-hidden style={{ verticalAlign: "-2px" }} /> A hosted Kiln cannot reach your computer on its own.
          Start <code>npm run bridge</code> there, then paste the code it prints.
        </p>
      </div>
    </Dialog>
  );
}
