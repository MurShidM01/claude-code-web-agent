"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import type { AppController, AppState } from "@/lib/app/controller";

export function ConnectionDialog({ state, controller }: { state: AppState; controller: AppController }) {
  const [root, setRoot] = useState(state.bridge.health?.suggestedRoot ?? state.bridge.health?.workspace?.root ?? "");
  const [code, setCode] = useState("");
  useEffect(() => {
    const suggested = state.bridge.health?.suggestedRoot ?? state.bridge.health?.workspace?.root;
    if (suggested) setRoot((current) => current || suggested);
  }, [state.bridge.health?.suggestedRoot, state.bridge.health?.workspace?.root]);
  return (
    <Dialog open={state.connectionOpen} title="Connect a workspace" onClose={() => controller.setConnectionOpen(false)}>
      <p>
        Local mode uses the bridge running beside this app. Deploy mode keeps the chat, and gains files and a shell only when you pair a bridge on your own computer.
      </p>
      <div className="status-row">
        <span className={`dot ${state.bridge.status === "connected" ? "ok" : "bad"}`} />
        {state.bridge.status === "connected"
          ? `Bridge connected via ${state.bridge.transport}`
          : state.bridge.error || "Bridge unavailable"}
      </div>
      <label className="field">
        Workspace path
        <input value={root} placeholder="/path/to/project" onChange={(event) => setRoot(event.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => void controller.refreshBridge()}>
          Check bridge
        </button>
        <button type="button" className="btn" onClick={() => void controller.pickFolder()} disabled={!state.fsaSupported}>
          {state.fsaSupported ? "Pick folder" : "Folder picker unsupported"}
        </button>
        <button type="button" className="btn primary" onClick={() => void controller.selectBridgeWorkspace(root)} disabled={!root || state.bridge.status !== "connected"}>
          Use path
        </button>
      </div>
      <label className="field">
        Pairing code from the bridge terminal
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Shown when the bridge starts" />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => void controller.pairDirect(code)} disabled={!code.trim()}>
          Pair this browser
        </button>
      </div>
      <p className="meta">Picking a folder uses the File System Access API for reads and writes. Commands, git, and processes still need the bridge.</p>
    </Dialog>
  );
}
