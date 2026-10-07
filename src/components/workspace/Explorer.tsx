"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, FolderPlus, FolderOpen, X } from "lucide-react";
import type { AppController, AppState } from "@/lib/app/controller";

export function Explorer({ state, controller }: { state: AppState; controller: AppController }) {
  const [entries, setEntries] = useState<{ name: string; path: string; kind: string }[]>([]);
  useEffect(() => {
    if (!state.explorerOpen || state.workspace.kind === "none") {
      setEntries([]);
      return;
    }
    let live = true;
    void controller.listRoot().then((list) => {
      if (live) setEntries(list);
    });
    return () => {
      live = false;
    };
  }, [controller, state.explorerOpen, state.workspace.kind, state.workspace.root, state.running]);
  if (!state.explorerOpen) return null;
  const connected = state.workspace.kind !== "none";
  return (
    <aside className="explorer" aria-label="Project files">
      <div className="panel-head">
        <span className="sp-icon" aria-hidden style={{ width: 26, height: 26, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          <FolderOpen size={15} />
        </span>
        <div className="panel-title">
          <h1>Project</h1>
          <p>{connected ? state.workspace.label ?? state.workspace.root : "Nothing open yet"}</p>
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
        {!connected ? (
          <div style={{ padding: 10 }}>
            <p className="meta" style={{ margin: "4px 2px 10px" }}>
              Open the project the agent should work in. Until then the chat works, but no file or command tool can run.
            </p>
            <button type="button" className="btn primary block" onClick={() => controller.setConnectionOpen(true)}>
              <FolderPlus size={15} aria-hidden />
              Open project
            </button>
          </div>
        ) : (
          <>
            {entries.length === 0 ? <p className="meta" style={{ padding: "8px 10px" }}>Nothing at the project root.</p> : null}
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="file-row"
                onClick={() => entry.kind === "file" && void controller.openPreview(entry.path)}
                title={entry.path}
              >
                {entry.kind === "directory" ? <Folder size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
              </button>
            ))}
          </>
        )}
        {state.previewPath ? (
          <div className="card" style={{ margin: "10px 8px" }}>
            <div className="card-head">
              <span className="name">{state.previewPath}</span>
              <span className="spacer" />
              <button type="button" className="icon-btn ghost" onClick={() => controller.closePreview()} aria-label="Close preview" title="Close preview">
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="card-body">
              {state.previewError ? <p className="meta">{state.previewError}</p> : <div className="terminal">{state.previewText}</div>}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
