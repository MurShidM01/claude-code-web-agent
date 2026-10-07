"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FolderOpen, FolderPlus, Paperclip, PencilLine, ShieldQuestion, Square, X, Zap } from "lucide-react";
import { ModelPicker } from "@/components/model/ModelPicker";
import { Menu } from "@/components/ui/Menu";
import type { AppController, AppState } from "@/lib/app/controller";
import { PERMISSION_MODE_LABEL, type PermissionMode } from "@/lib/permissions/types";

const MODE_ICON: Record<PermissionMode, typeof ShieldQuestion> = {
  ask: ShieldQuestion,
  "auto-edit": PencilLine,
  full: Zap,
};

const MODE_DESCRIPTION: Record<PermissionMode, string> = {
  ask: "Approve every mutating or privileged action",
  "auto-edit": "Edit files freely; ask before shell and other privileged work",
  full: "Continue the loop; still ask for dangerous commands",
};

export function Composer({
  state,
  controller,
  permissionMode,
  modelId,
  onOpenProject,
}: {
  state: AppState;
  controller: AppController;
  permissionMode: PermissionMode;
  modelId: string | null;
  onOpenProject: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ name: string; mediaType: string; text?: string; dataUrl?: string }[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ModeIcon = MODE_ICON[permissionMode];
  const hasProject = state.workspace.kind !== "none";

  useEffect(() => {
    const fill = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setText(detail);
      box.current?.focus();
    };
    window.addEventListener("kiln:fill", fill);
    return () => window.removeEventListener("kiln:fill", fill);
  }, []);

  /* Grow with the draft, up to a cap, instead of a fixed two-row box. */
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`;
  }, [text]);

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next: { name: string; mediaType: string; text?: string; dataUrl?: string }[] = [];
    for (const file of [...list].slice(0, 4)) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await fileToDataUrl(file);
        next.push({ name: file.name, mediaType: file.type, dataUrl });
      } else {
        const text = (await file.text()).slice(0, 20_000);
        next.push({ name: file.name, mediaType: file.type || "text/plain", text });
      }
    }
    setFiles((current) => [...current, ...next].slice(0, 6));
  }

  function send() {
    if (!text.trim() && !files.length) return;
    void controller.send(text, files);
    setText("");
    setFiles([]);
  }

  return (
    <>
      {!hasProject ? (
        <button type="button" className="composer-notice" onClick={onOpenProject} title="Open the project the agent should work in">
          <FolderPlus size={14} aria-hidden />
          <span>
            <strong>No project open.</strong> Kiln can talk, but it will not invent file changes or command output.
          </span>
        </button>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          id="composer"
          ref={box}
          rows={1}
          aria-label="Message Kiln"
          placeholder={hasProject ? `Ask Kiln about ${state.workspace.label}` : "Describe a coding task"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        {files.length ? (
          <div className="attach-list">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="attach-chip" title={file.name}>
                <Paperclip size={12} aria-hidden />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="composer-bar">
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button type="button" className="icon-btn" title="Attach files" aria-label="Attach files" onClick={() => fileInput.current?.click()}>
            <Paperclip size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={`chip${hasProject ? "" : " alert"}`}
            title={hasProject ? `${state.workspace.root ?? state.workspace.label} · ${PERMISSION_MODE_LABEL[permissionMode]}` : "Open a project (Ctrl/⌘ O)"}
            onClick={onOpenProject}
          >
            {hasProject ? <FolderOpen size={14} aria-hidden /> : <FolderPlus size={14} aria-hidden />}
            <span className="chip-label hide-sm">{hasProject ? state.workspace.label : "Open project"}</span>
          </button>
          <ModelPicker
            state={state}
            selectedId={modelId}
            onQuery={(value) => controller.setModelQuery(value)}
            onProvider={(value) => controller.setModelProvider(value)}
            onSort={(value) => controller.setModelSort(value)}
            onSelect={(id, provider) => controller.selectModel(id, provider)}
            onRefresh={() => void controller.refreshModels()}
          />
          <Menu
            triggerTitle={`Permission mode: ${PERMISSION_MODE_LABEL[permissionMode]}`}
            label={
              <>
                <ModeIcon size={14} aria-hidden />
                <span className="chip-label hide-sm">{PERMISSION_MODE_LABEL[permissionMode]}</span>
              </>
            }
            value={permissionMode}
            options={[
              { id: "ask", label: "Ask Every Time", description: MODE_DESCRIPTION.ask },
              { id: "auto-edit", label: "Auto-Edit Only", description: MODE_DESCRIPTION["auto-edit"] },
              { id: "full", label: "Full Access", description: MODE_DESCRIPTION.full },
            ]}
            onChange={(id) => controller.setPermissionMode(id as PermissionMode)}
          />
          <div className="spacer" />
          {state.running ? (
            <button type="button" className="send-btn stop" onClick={() => controller.cancel()} aria-label="Stop" title="Stop (Esc)">
              <Square size={13} aria-hidden fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!text.trim() && !files.length} aria-label="Send" title="Send (Enter)">
              <ArrowUp size={17} aria-hidden strokeWidth={2.4} />
            </button>
          )}
        </div>
      </form>
      <p className="disclaimer">Enter to send · Shift+Enter for a new line · Esc stops a turn · Kiln can make mistakes, so review the diffs.</p>
    </>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
