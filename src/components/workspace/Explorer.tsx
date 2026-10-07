"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, FolderPlus, FolderOpen, PanelRightClose, RefreshCw, X } from "lucide-react";
import type { AppController, AppState } from "@/lib/app/controller";

export function Explorer({ state, controller }: { state: AppState; controller: AppController }) {
  const [entries, setEntries] = useState<{ name: string; path: string; kind: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(0);
  const connected = state.workspace.kind !== "none";

  useEffect(() => {
    if (!state.explorerOpen || state.workspace.kind === "none") {
      setEntries([]);
      return;
    }
    let live = true;
    setLoading(true);
    void controller.listRoot().then((list) => {
      if (!live) return;
      setEntries(list);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [controller, state.explorerOpen, state.workspace.kind, state.workspace.root, state.running, refreshing]);

  if (!state.explorerOpen) return null;

  return (
    <aside className="explorer" aria-label="Project files">
      <div className="panel-head">
        <span className="panel-mark" aria-hidden>
          <FolderOpen size={15} />
        </span>
        <div className="panel-title">
          <h1>Project</h1>
          <p>{connected ? state.workspace.label ?? state.workspace.root : "Nothing open yet"}</p>
        </div>
        {connected ? (
          <button
            type="button"
            className="icon-btn ghost"
            onClick={() => setRefreshing((value) => value + 1)}
            aria-label="Refresh file list"
            title="Refresh file list"
          >
            <RefreshCw size={15} aria-hidden className={loading ? "spin" : undefined} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn ghost"
          onClick={() => controller.toggleExplorer()}
          aria-label="Close file panel"
          title="Close file panel"
        >
          <PanelRightClose size={17} aria-hidden />
        </button>
      </div>
      <div className="panel-scroll">
        {!connected ? (
          <div className="panel-empty">
            <p>
              Open the project the agent should work in. Until then the chat works, but no file or command tool can run.
            </p>
            <button type="button" className="btn primary block" onClick={() => controller.setConnectionOpen(true)}>
              <FolderPlus size={15} aria-hidden />
              Open project
            </button>
          </div>
        ) : (
          <>
            {entries.length === 0 && !loading ? <p className="meta panel-note">Nothing at the project root.</p> : null}
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`file-row${entry.kind === "directory" ? " is-dir" : ""}${entry.kind === "file" ? " is-file" : ""}`}
                onClick={() => entry.kind === "file" && void controller.openPreview(entry.path)}
                title={entry.path}
              >
                {entry.kind === "directory" ? <Folder size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
                <span className="file-name">{entry.name}</span>
              </button>
            ))}
          </>
        )}
        {state.previewPath ? (
          <div className="card preview-card">
            <div className="card-head">
              <span className="name">{state.previewPath}</span>
              <span className="spacer" />
              <button type="button" className="icon-btn ghost" onClick={() => controller.closePreview()} aria-label="Close preview" title="Close preview">
                <X size={15} aria-hidden />
              </button>
            </div>
            <div className="card-body">
              {state.previewError ? <p className="meta error">{state.previewError}</p> : <div className="terminal">{state.previewText}</div>}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
