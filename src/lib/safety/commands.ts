import type { Risk } from "@/lib/events/types";

export interface CommandAssessment {
  risk: Risk;
  blocked: boolean;
  critical: boolean;
  reasons: string[];
  summary: string;
}

const BLOCKED: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\brm\s+(-[a-z]*f[a-z]*|--force)\s+(\/|\/\*|~|~\/|\$HOME)(\s|$)/i,
    reason: "Recursive delete of the filesystem root or home directory is blocked.",
  },
  {
    pattern: /\bmkfs(\.\w+)?\b/i,
    reason: "Formatting a filesystem is blocked.",
  },
  {
    pattern: /\bdd\b[\s\S]*\bof=\/dev\/(sd|nvme|disk|hd)/i,
    reason: "Writing a disk image to a raw device is blocked.",
  },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
    reason: "Fork bombs are blocked.",
  },
  {
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/i,
    reason: "Power commands are blocked.",
  },
  {
    pattern: />\s*\/dev\/(sd|nvme|disk|hd)/,
    reason: "Redirecting output onto a raw disk is blocked.",
  },
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/,
    reason: "Making the filesystem root world-writable is blocked.",
  },
];

const CRITICAL: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bgit\s+push\b[\s\S]*(\s--force|\s-f\b|\s--force-with-lease)/i,
    reason: "Force-pushing rewrites remote history.",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "git reset --hard discards uncommitted work.",
  },
  {
    pattern: /\bgit\s+clean\b[\s\S]*\s-[a-z]*f/i,
    reason: "git clean -f deletes untracked files.",
  },
  {
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
    reason: "Recursive forced delete can remove more than intended.",
  },
  {
    pattern: /\bsudo\b/i,
    reason: "sudo elevates beyond the workspace user.",
  },
  {
    pattern: /\bchmod\s+-R\s+777\b/i,
    reason: "Recursive world-writable permissions are dangerous.",
  },
  {
    pattern: /\b(curl|wget)\b[\s\S]*\|\s*(ba)?sh\b/i,
    reason: "Piping a remote script into a shell is dangerous.",
  },
  {
    pattern: /\b(curl|wget)\b[\s\S]*\|\s*(python|perl|ruby|node)\b/i,
    reason: "Piping a remote script into an interpreter is dangerous.",
  },
];

const INSTALL =
  /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b|\bpip3?\s+install\b|\bcargo\s+install\b|\bbrew\s+install\b|\bapt(-get)?\s+install\b|\bgo\s+install\b/i;

const GIT_WRITE =
  /\bgit\s+(commit|add|rm|mv|checkout|switch|restore|merge|rebase|cherry-pick|tag|stash|push|pull|fetch|reset|clean|init|branch|remote)\b/i;

const NETWORK =
  /\b(curl|wget|ssh|scp|sftp|nc|ncat|telnet|ftp)\b|\bgit\s+(push|pull|fetch|clone)\b/i;

export function assessCommand(command: string): CommandAssessment {
  const reasons: string[] = [];
  for (const rule of BLOCKED) {
    if (rule.pattern.test(command)) {
      reasons.push(rule.reason);
      return {
        risk: "blocked",
        blocked: true,
        critical: true,
        reasons,
        summary: "Blocked command",
      };
    }
  }
  for (const rule of CRITICAL) {
    if (rule.pattern.test(command)) reasons.push(rule.reason);
  }
  if (reasons.length) {
    return {
      risk: "critical",
      blocked: false,
      critical: true,
      reasons,
      summary: firstLine(command),
    };
  }
  if (INSTALL.test(command)) {
    return {
      risk: "install",
      blocked: false,
      critical: false,
      reasons: ["Installs or changes packages."],
      summary: firstLine(command),
    };
  }
  if (GIT_WRITE.test(command)) {
    const risk: Risk = NETWORK.test(command) ? "git-write" : "git-write";
    return {
      risk,
      blocked: false,
      critical: false,
      reasons: ["Changes git state."],
      summary: firstLine(command),
    };
  }
  if (NETWORK.test(command)) {
    return {
      risk: "network",
      blocked: false,
      critical: false,
      reasons: ["Can reach the network or another machine."],
      summary: firstLine(command),
    };
  }
  if (/^\s*git\s+(status|diff|log|show|blame|rev-parse|ls-files|remote\s+-v)\b/i.test(command)) {
    return {
      risk: "safe",
      blocked: false,
      critical: false,
      reasons: ["Read-only git inspection."],
      summary: firstLine(command),
    };
  }
  return {
    risk: "shell",
    blocked: false,
    critical: false,
    reasons: ["Runs a shell command in the workspace."],
    summary: firstLine(command),
  };
}

function firstLine(command: string): string {
  const line = command.trim().split("\n")[0] ?? command;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function looksLikeTestCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+(test|run\s+test)\b|\b(vitest|jest|pytest|go\s+test|cargo\s+test|rake\s+test)\b|\bnpm\s+run\s+(lint|typecheck|build)\b/i.test(
    command,
  );
}
