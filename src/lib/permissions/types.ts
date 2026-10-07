import type { Risk } from "@/lib/events/types";

export type PermissionMode = "ask" | "auto-edit" | "full";

export const PERMISSION_MODE_LABEL: Record<PermissionMode, string> = {
  ask: "Ask Every Time",
  "auto-edit": "Auto-Edit Only",
  full: "Full Access",
};

export const PERMISSION_MODE_DETAIL: Record<PermissionMode, string> = {
  ask: "Approve every file write, delete, rename, command, install, git change, and network call.",
  "auto-edit": "File creates and edits run automatically. Shell, deletes, git writes, installs, and network calls still ask.",
  full: "The agent continues through the tool loop. Catastrophic commands stay blocked, and dangerous ones still ask.",
};

export interface Operation {
  tool: string;
  risk: Risk;
  summary: string;
  why: string;
  paths: string[];
  command?: string;
  cwd?: string;
}

export interface SessionRule {
  signature: string;
  decision: "allow" | "deny";
  label: string;
  createdAt: number;
}

export interface PolicyInput {
  mode: PermissionMode;
  operation: Operation;
  sessionRules?: SessionRule[];
  denyPatterns?: string[];
}

export interface PolicyDecision {
  decision: "allow" | "ask" | "deny";
  risk: Risk;
  reason: string;
  signature: string;
  rememberable: boolean;
  rememberLabel: string;
}
