"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import type { AgentEvent } from "@/lib/events/types";

const RISK_TONE: Record<string, string> = {
  safe: "ok",
  edit: "info",
  structure: "warn",
  shell: "warn",
  network: "warn",
  "git-write": "warn",
  install: "warn",
  critical: "bad",
  blocked: "bad",
};

export function PermissionDialog({
  request,
  onDecide,
}: {
  request: Extract<AgentEvent, { type: "permission_requested" }> | null;
  onDecide: (granted: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    setRemember(false);
  }, [request?.requestId]);
  if (!request) return null;
  return (
    <Dialog open title="Allow this action?" labelledBy="permission-title">
      <p id="permission-copy">
        Kiln wants to {request.summary.toLowerCase()}. Nothing runs until you choose.
      </p>
      <div className="kv">
        <div>
          <dt>What</dt>
          <dd>{request.name} — {request.summary}</dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd>{request.why}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>
            <span className={`badge ${RISK_TONE[request.risk] ?? ""}`}>{request.risk}</span>
          </dd>
        </div>
        {request.paths.length ? (
          <div>
            <dt>Paths</dt>
            <dd>{request.paths.join("\n")}</dd>
          </div>
        ) : null}
        {request.command ? (
          <div>
            <dt>Command</dt>
            <dd>{request.command}</dd>
          </div>
        ) : null}
        <div>
          <dt>Working directory</dt>
          <dd>{request.cwd || "workspace root"}</dd>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span>{request.rememberLabel}</span>
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => onDecide(false, remember)}>
          Deny
        </button>
        <button type="button" className="btn primary" onClick={() => onDecide(true, remember)}>
          Allow
        </button>
      </div>
    </Dialog>
  );
}
