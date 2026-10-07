"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, FolderOpen, X } from "lucide-react";
import type { AppController, AppState } from "@/lib/app/controller";

export function Explorer({ state, controller }: { state: AppState; controller: AppController }) {
  const [entries, setEntries] = useState<{ name: string; path: string; kind: string }[]>([]);
  useEffect(() => {
    if (!state.explorerOpen || state.workspace.kind === "none") return;
    void controller.listRoot().then(setEntries);
  }, [controller, state.explorerOpen, state.workspace.kind, state.workspace.root, state.running]);
  if (!state.explorerOpen) return null;
  return (
    <aside className="explorer" aria-label="Project files">
      <div className="panel-head">
        <FolderOpen size={18} aria-hidden style={{ color: "var(--accent-ink)", flex: "none" }} />
        <div className="panel-title">
          <h1>Project</h1>
          <p>{state.workspace.label ?? "Not connected"}</p>
        </div>
        <button
          type="button"
          className="icon-btn ghost"
          onClick={() => controller.toggleExplorer()}
          aria-label="Close file panel"
          title="Close file panel"
        >
          <X size={17} aria-hidden />
        </button>
      </div>
      <div className="side-scroll">
        {state.workspace.kind === "none" ? (
          <p className="meta" style={{ padding: 8 }}>Connect a workspace to browse files. The chat stays the main surface.</p>
        ) : (
          entries.map((entry) => (
            <button key={entry.path} type="button" className="file-row" onClick={() => entry.kind === "file" && void controller.openPreview(entry.path)}>
              {entry.kind === "directory" ? <Folder size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
            </button>
          ))
        )}
        {state.previewPath ? (
          <div className="card" style={{ margin: 8 }}>
            <div className="card-head">
              <span className="name">{state.previewPath}</span>
              <span className="spacer" />
              <button type="button" className="icon-btn ghost" onClick={() => controller.closePreview()} aria-label="Close preview" title="Close preview">
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="card-body">
              {state.previewError ? <p>{state.previewError}</p> : <div className="terminal">{state.previewText}</div>}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
