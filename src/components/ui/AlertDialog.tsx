"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FolderInput, Info, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";

export type DialogTone = "info" | "success" | "warning" | "danger";

const MARK = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: Trash2,
} as const;

const KICKER: Record<DialogTone, string> = {
  info: "Notice",
  success: "Done",
  warning: "Check this",
  danger: "Needs attention",
};

export function inferTone(title: string): DialogTone {
  if (/fail|error|could not|cannot|unavailable|denied|stopped/i.test(title)) return "danger";
  if (/revert|restored|connected|saved|done/i.test(title)) return "success";
  if (/choose|sign in|wait|no longer|forgot|import|remove|delete/i.test(title)) return "warning";
  return "info";
}

export function AlertDialog({
  open,
  title,
  message,
  tone,
  onClose,
  actions,
}: {
  open: boolean;
  title: string;
  message: string;
  tone?: DialogTone;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const resolved = tone ?? inferTone(title);
  const Icon = MARK[resolved];
  return (
    <Dialog open={open} title={title} layout="alert" priority="front" onClose={onClose}>
      <div className="modal-head">
        <span className={`modal-mark ${resolved}`} aria-hidden>
          <Icon size={18} />
        </span>
        <div>
          <p className="modal-kicker">{KICKER[resolved]}</p>
          <h3>{title}</h3>
          <p>{message}</p>
        </div>
      </div>
      <div className="dialog-actions">
        {actions ?? (
          <button type="button" className="btn primary" data-autofocus onClick={onClose}>
            OK
          </button>
        )}
      </div>
    </Dialog>
  );
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "info";
}

export function ConfirmDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tone = request?.tone ?? "danger";
  const Icon = tone === "info" ? FolderInput : Trash2;
  return (
    <Dialog open={Boolean(request)} title={request?.title ?? "Confirm"} layout="alert" priority="front" onClose={onCancel}>
      <div className="modal-head">
        <span className={`modal-mark ${tone === "info" ? "info" : "danger"}`} aria-hidden>
          <Icon size={18} />
        </span>
        <div>
          <p className="modal-kicker">{tone === "info" ? "Import" : "Confirm"}</p>
          <h3>{request?.title}</h3>
          <p>{request?.message}</p>
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" data-autofocus onClick={onCancel}>
          {request?.cancelLabel ?? "Cancel"}
        </button>
        <button type="button" className={tone === "info" ? "btn primary" : "btn danger"} onClick={onConfirm}>
          {request?.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Dialog>
  );
}

export async function confirmed(
  controller: { requestConfirm: (input: ConfirmRequest) => Promise<boolean> },
  input: ConfirmRequest,
  action: () => void | Promise<void>,
) {
  const ok = await controller.requestConfirm(input);
  if (!ok) return;
  await action();
}
