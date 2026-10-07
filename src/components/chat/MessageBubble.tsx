"use client";

import { useState } from "react";
import { Brain, Check, Copy, Pencil, RotateCcw } from "lucide-react";
import { MarkdownView } from "@/components/chat/MarkdownView";
import type { AppController } from "@/lib/app/controller";
import type { AssistantBlock, UserBlock } from "@/lib/events/reducer";

export function UserBubble({
  block,
  controller,
  running,
}: {
  block: UserBlock;
  controller: AppController;
  running: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.text);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const ok = await copyText(block.text);
    if (!ok) controller.notify("Could not copy", "The browser refused clipboard access.", "warning");
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="msg user">
      {editing ? (
        <form
          className="msg-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.editUserMessage(block.id, draft).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <textarea
            aria-label="Edit message"
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(block.text);
                setEditing(false);
              }
            }}
          />
          <div className="msg-edit-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(block.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!draft.trim() || running}>
              Save and send
            </button>
          </div>
        </form>
      ) : (
        <div className="user-msg">
          {block.text}
          {block.attachments?.length ? <div className="meta">{block.attachments.map((item) => item.name).join(", ")}</div> : null}
        </div>
      )}
      {editing ? null : (
        <div className="msg-actions">
          <button type="button" className="msg-action" onClick={() => void copy()}>
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="msg-action"
            disabled={running}
            onClick={() => {
              setDraft(block.text);
              setEditing(true);
            }}
          >
            <Pencil size={13} aria-hidden />
            Edit
          </button>
          <button type="button" className="msg-action" disabled={running} onClick={() => void controller.retryMessage(block.id)}>
            <RotateCcw size={13} aria-hidden />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export function AssistantBubble({
  block,
  controller,
  running,
}: {
  block: AssistantBlock;
  controller: AppController;
  running: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const ok = await copyText(block.text);
    if (!ok) controller.notify("Could not copy", "The browser refused clipboard access.", "warning");
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="msg assistant">
      {block.reasoning ? (
        <details className="reasoning">
          <summary>
            <Brain size={13} aria-hidden />
            Reasoning
          </summary>
          <p>{block.reasoning}</p>
        </details>
      ) : null}
      <MarkdownView text={block.text} streaming={block.streaming} />
      {block.streaming ? null : (
        <div className="msg-actions">
          <button type="button" className="msg-action" onClick={() => void copy()}>
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="msg-action" disabled={running} onClick={() => void controller.retryMessage(block.id)}>
            <RotateCcw size={13} aria-hidden />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
