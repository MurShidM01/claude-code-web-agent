import type { Risk } from "@/lib/events/types";
import type {
  Operation,
  PermissionMode,
  PolicyDecision,
  PolicyInput,
  SessionRule,
} from "@/lib/permissions/types";

const MATRIX: Record<PermissionMode, Record<Risk, "allow" | "ask" | "deny">> = {
  ask: {
    safe: "allow",
    edit: "ask",
    structure: "ask",
    shell: "ask",
    network: "ask",
    "git-write": "ask",
    install: "ask",
    critical: "ask",
    blocked: "deny",
  },
  "auto-edit": {
    safe: "allow",
    edit: "allow",
    structure: "ask",
    shell: "ask",
    network: "ask",
    "git-write": "ask",
    install: "ask",
    critical: "ask",
    blocked: "deny",
  },
  full: {
    safe: "allow",
    edit: "allow",
    structure: "allow",
    shell: "allow",
    network: "allow",
    "git-write": "allow",
    install: "allow",
    critical: "ask",
    blocked: "deny",
  },
};

export function operationSignature(op: Operation): string {
  if (op.command) {
    return `bash\u0000${op.cwd ?? ""}\u0000${op.command}`;
  }
  const paths = [...op.paths].sort().join("|");
  return `${op.tool}\u0000${paths}\u0000${op.risk}`;
}

export function rememberLabel(op: Operation): string {
  if (op.command) {
    const shown = op.command.length > 80 ? `${op.command.slice(0, 77)}…` : op.command;
    return `Run this exact command again without asking: ${shown}`;
  }
  if (op.paths.length === 1) {
    return `Allow ${op.tool} on ${op.paths[0]} for this session`;
  }
  if (op.paths.length > 1) {
    return `Allow ${op.tool} on these ${op.paths.length} paths for this session`;
  }
  return `Allow ${op.tool} (${op.summary}) for this session`;
}

function patternHit(pattern: string, op: Operation): boolean {
  const haystack = [op.tool, op.command ?? "", op.summary, ...op.paths].join("\n");
  try {
    return new RegExp(pattern, "i").test(haystack);
  } catch {
    return haystack.toLowerCase().includes(pattern.toLowerCase());
  }
}

export function decide(input: PolicyInput): PolicyDecision {
  const signature = operationSignature(input.operation);
  const label = rememberLabel(input.operation);
  const base = {
    risk: input.operation.risk,
    signature,
    rememberLabel: label,
  };

  const deniedBySetting = (input.denyPatterns ?? []).find((pattern) =>
    patternHit(pattern, input.operation),
  );
  if (deniedBySetting) {
    return {
      ...base,
      decision: "deny",
      rememberable: false,
      reason: `Blocked by a command-safety rule (${deniedBySetting}).`,
    };
  }

  if (input.operation.risk === "blocked") {
    return {
      ...base,
      decision: "deny",
      rememberable: false,
      reason:
        "This operation is blocked because it can destroy the system or escape the workspace. It will not run in any permission mode.",
    };
  }

  const session = (input.sessionRules ?? []).find((rule) => rule.signature === signature);
  if (session?.decision === "deny") {
    return {
      ...base,
      decision: "deny",
      rememberable: false,
      reason: "You denied this exact action for the current session.",
    };
  }
  if (session?.decision === "allow") {
    return {
      ...base,
      decision: "allow",
      rememberable: false,
      reason: "Allowed for this session by an earlier approval.",
    };
  }

  const decision = MATRIX[input.mode][input.operation.risk];
  const reason =
    decision === "allow"
      ? allowanceReason(input.mode, input.operation.risk)
      : decision === "ask"
        ? askReason(input.mode, input.operation.risk)
        : "Denied by the active permission policy.";

  return {
    ...base,
    decision,
    rememberable: decision === "ask",
    reason,
  };
}

function allowanceReason(mode: PermissionMode, risk: Risk): string {
  if (risk === "safe") return "Read-only workspace inspection does not require approval.";
  if (mode === "auto-edit" && risk === "edit") {
    return "Auto-Edit Only allows file creation and modification.";
  }
  if (mode === "full") return "Full Access allows this operation without a prompt.";
  return "Allowed by the active permission policy.";
}

function askReason(mode: PermissionMode, risk: Risk): string {
  if (risk === "critical") {
    return "This looks dangerous. Kiln asks even in Full Access.";
  }
  if (mode === "ask") return "Ask Every Time requires approval before this action.";
  if (mode === "auto-edit") {
    return "Auto-Edit Only still asks before shell, delete, git, install, and network actions.";
  }
  return "Approval is required.";
}

export class PermissionGate {
  private grants = new Map<string, { signature: string; used: boolean }>();

  issue(signature: string): string {
    const id = `grant_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    this.grants.set(id, { signature, used: false });
    return id;
  }

  consume(grantId: string, signature: string): void {
    const grant = this.grants.get(grantId);
    if (!grant) {
      throw new Error("Permission gate rejected execution: missing grant. Tools cannot bypass the policy engine.");
    }
    if (grant.used) {
      throw new Error("Permission gate rejected execution: grant already used. Tools cannot bypass the policy engine.");
    }
    if (grant.signature !== signature) {
      throw new Error("Permission gate rejected execution: grant does not match this operation.");
    }
    grant.used = true;
  }
}

export function addSessionRule(
  rules: SessionRule[],
  rule: SessionRule,
): SessionRule[] {
  return [...rules.filter((item) => item.signature !== rule.signature), rule];
}
