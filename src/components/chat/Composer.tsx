"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, PencilLine, ShieldQuestion, Square, X, Zap } from "lucide-react";
import { ModelPicker } from "@/components/model/ModelPicker";
import { Menu } from "@/components/ui/Menu";
import type { AppController, AppState } from "@/lib/app/controller";
import { PERMISSION_MODE_LABEL, type PermissionMode } from "@/lib/permissions/types";

const MODE_ICON: Record<PermissionMode, typeof ShieldQuestion> = {
  ask: ShieldQuestion,
  "auto-edit": PencilLine,
  full: Zap,
};

export function Composer({
  state,
  controller,
  permissionMode,
  modelId,
}: {
  state: AppState;
  controller: AppController;
  permissionMode: PermissionMode;
  modelId: string | null;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ name: string; mediaType: string; text?: string; dataUrl?: string }[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const ModeIcon = MODE_ICON[permissionMode];

  useEffect(() => {
    const fill = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setText(detail);
      box.current?.focus();
    };
    window.addEventListener("kiln:fill", fill);
    return () => window.removeEventListener("kiln:fill", fill);
  }, []);

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
    <div className="composer-wrap">
      <div className="column">
        {state.workspace.kind === "none" ? (
          <div className="banner">No workspace connected. Kiln can talk, but it will not invent file changes or command output.</div>
        ) : null}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label className="hint" htmlFor="composer">
            {state.workspace.label ? state.workspace.label : "No project"} · {PERMISSION_MODE_LABEL[permissionMode]}
          </label>
          <textarea
            id="composer"
            ref={box}
            rows={2}
            placeholder="Describe a coding task"
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
              label={
                <>
                  <ModeIcon size={14} aria-hidden />
                  <span className="chip-label hide-sm">{PERMISSION_MODE_LABEL[permissionMode]}</span>
                </>
              }
              value={permissionMode}
              options={[
                { id: "ask", label: "Ask Every Time" },
                { id: "auto-edit", label: "Auto-Edit Only" },
                { id: "full", label: "Full Access" },
              ]}
              onChange={(id) => controller.setPermissionMode(id as PermissionMode)}
            />
            <label className="icon-btn" style={{ cursor: "pointer" }} title="Attach files" aria-label="Attach files">
              <Paperclip size={16} aria-hidden />
              <input
                type="file"
                hidden
                multiple
                onChange={(event) => {
                  void onFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            {state.running ? (
              <button type="button" className="send-btn stop" onClick={() => controller.cancel()} aria-label="Stop" title="Stop (Esc)">
                <Square size={15} aria-hidden fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send-btn" disabled={!text.trim() && !files.length} aria-label="Send" title="Send (Enter)">
                <ArrowUp size={18} aria-hidden strokeWidth={2.4} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
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
