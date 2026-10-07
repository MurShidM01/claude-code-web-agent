"use client";

import { useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, RotateCcw, Send } from "lucide-react";
import type { DiffBlock, PlanBlock, QuestionBlock, ToolBlock } from "@/lib/events/reducer";
import { languageFromPath } from "@/lib/workspace/path";

export function ToolCard({ block }: { block: ToolBlock }) {
  const [open, setOpen] = useState(block.name === "Bash" || block.status === "running" || block.status === "error");
  const [copied, setCopied] = useState(false);
  const command = block.command;
  const badge = statusBadge(block.status);
  const busy = block.status === "requested" || block.status === "running";
  return (
    <article className={`card tool-card${busy ? " busy" : ""}`}>
      <button type="button" className="card-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} className={`chev ${open ? "open" : ""}`} aria-hidden />
        <span className={`badge ${badge.tone}`}>
          {busy ? <span className="badge-spinner" aria-hidden /> : null}
          {badge.label}
        </span>
        <span className="name">{block.name}</span>
        <span className="summary">{block.summary}</span>
      </button>
      {open ? (
        <div className="card-body">
          {command ? (
            <>
              <div className="status-row">
                <span className="meta">cwd {block.cwd || "workspace"}</span>
                {block.durationMs != null ? <span className="meta">{(block.durationMs / 1000).toFixed(1)}s</span> : null}
                {block.exitCode != null ? <span className="meta">exit {block.exitCode}</span> : null}
                <button
                  type="button"
                  className="icon-btn ghost"
                  aria-label="Copy command"
                  title="Copy command"
                  onClick={() =>
                    void navigator.clipboard.writeText(command).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    })
                  }
                >
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                </button>
              </div>
              <div className="terminal">{command}</div>
            </>
          ) : (
            <div className="terminal">{JSON.stringify(block.input, null, 2)?.slice(0, 2000)}</div>
          )}
          {block.stdout ? <div className="terminal" style={{ marginTop: 8 }}>{block.stdout}</div> : null}
          {block.stderr ? <div className="terminal stderr" style={{ marginTop: 8 }}>{block.stderr}</div> : null}
          {block.output && !command ? (
            <div className="terminal" style={{ marginTop: 8 }}>{formatOutput(block.output)}</div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function DiffCard({
  block,
  onOpen,
  onRevert,
}: {
  block: DiffBlock;
  onOpen: (path: string) => void;
  onRevert: (path: string, original: string | null) => void;
}) {
  const [open, setOpen] = useState(block.diff.additions + block.diff.deletions < 80);
  const lines = block.diff.patch.split("\n").filter((line) => !line.startsWith("---") && !line.startsWith("+++") && !line.startsWith("Index"));
  return (
    <article className="card">
      <button type="button" className="card-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} className={`chev ${open ? "open" : ""}`} aria-hidden />
        <span className="badge ok">{block.diff.created ? "new" : block.diff.deleted ? "deleted" : "edit"}</span>
        <span className="name">{block.diff.path}</span>
        <span className="summary">
          +{block.diff.additions} −{block.diff.deletions} · {languageFromPath(block.diff.path)}
        </span>
      </button>
      {open ? (
        <div className="card-body">
          <div className="diff-scroll">
            {lines.slice(0, 400).map((line, index) => (
              <div key={`${index}-${line.slice(0, 12)}`} className={`diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}`}>
                {line || " "}
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => onOpen(block.diff.path)} title="Open file in the file panel">
              <ExternalLink size={14} aria-hidden />
              Open file
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onRevert(block.diff.path, block.diff.original)}
              disabled={block.diff.original == null}
              title="Restore the file to its state before this change"
            >
              <RotateCcw size={14} aria-hidden />
              Revert change
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PlanCard({ block }: { block: PlanBlock }) {
  return (
    <article className="card">
      <div className="card-head">
        <span className="badge info">plan</span>
        <span className="summary">Task plan</span>
      </div>
      <div className="card-body">
        {block.todos.map((todo) => (
          <div key={todo.id} className="plan-item">
            <span className={`badge ${todo.status === "completed" ? "ok" : todo.status === "in_progress" ? "warn" : ""}`}>{todo.status.replace("_", " ")}</span>
            <span>{todo.content}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function QuestionCard({
  block,
  onAnswer,
}: {
  block: QuestionBlock;
  onAnswer: (questionId: string, answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(block.answers ?? {});
  return (
    <article className="card">
      <div className="card-head">
        <span className="badge warn">question</span>
        <span className="summary">Kiln needs a decision before continuing</span>
      </div>
      <div className="card-body question">
        {block.questions.map((question) => (
          <label key={question.id} className="field">
            <span>{question.prompt}</span>
            {question.options?.length ? (
              <div className="chip-row">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="chip"
                    aria-pressed={answers[question.id] === option}
                    onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <input
                value={answers[question.id] ?? ""}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            )}
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn primary" disabled={Boolean(block.answers)} onClick={() => onAnswer(block.questionId, answers)}>
            <Send size={14} aria-hidden />
            {block.answers ? "Answered" : "Send answers"}
          </button>
        </div>
      </div>
    </article>
  );
}

function statusBadge(status: ToolBlock["status"]): { label: string; tone: string } {
  if (status === "done") return { label: "done", tone: "ok" };
  if (status === "running" || status === "requested") return { label: status, tone: "info" };
  if (status === "denied" || status === "cancelled") return { label: status, tone: "warn" };
  return { label: status, tone: "bad" };
}

function formatOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
}
