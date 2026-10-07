import type { Operation } from "@/lib/permissions/types";
import { assessCommand } from "@/lib/safety/commands";
import { asRecord } from "@/lib/tools/registry";

function op(partial: Omit<Operation, "paths"> & { paths?: string[] }): Operation {
  return { paths: partial.paths ?? [], ...partial };
}

export function classifyTool(name: string, raw: unknown): Operation {
  const input = asRecord(raw);
  const pathOf = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");

  switch (name) {
    case "Read":
    case "LS":
    case "Glob":
    case "Grep":
    case "Stat":
    case "BashOutput":
    case "GitStatus":
    case "GitDiff":
    case "GitLog":
    case "Skill":
    case "ReportFindings":
    case "TodoWrite":
      return op({
        tool: name,
        risk: "safe",
        summary: summaryFor(name, input),
        why: whyFor(name, input),
        paths: [pathOf("file_path") || pathOf("path") || pathOf("notebook_path") || pathOf("task_id")].filter(Boolean),
      });
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return op({
        tool: name,
        risk: "edit",
        summary: summaryFor(name, input),
        why: whyFor(name, input),
        paths: [pathOf("file_path") || pathOf("notebook_path")].filter(Boolean),
      });
    case "Delete": {
      const recursive = input.recursive === true;
      return op({
        tool: name,
        risk: recursive ? "critical" : "structure",
        summary: `Delete ${pathOf("path")}${recursive ? " recursively" : ""}`,
        why: recursive
          ? "Recursive delete can remove a whole tree and is not a normal edit."
          : "Deleting a path cannot be expressed as a content edit.",
        paths: [pathOf("path")].filter(Boolean),
      });
    }
    case "Move":
      return op({
        tool: name,
        risk: "structure",
        summary: `Move ${pathOf("from")} to ${pathOf("to")}`,
        why: "Renaming changes project structure and may overwrite a destination.",
        paths: [pathOf("from"), pathOf("to")].filter(Boolean),
      });
    case "Bash":
    case "PowerShell": {
      const command = pathOf("command");
      const assessed = assessCommand(command);
      return op({
        tool: name,
        risk: assessed.risk,
        summary: typeof input.description === "string" && input.description.trim()
          ? input.description.trim()
          : assessed.summary,
        why: assessed.reasons.join(" "),
        paths: [],
        command,
        cwd: pathOf("cwd") || undefined,
      });
    }
    case "WebFetch":
    case "WebSearch":
      return op({
        tool: name,
        risk: "network",
        summary: name === "WebFetch" ? `Fetch ${pathOf("url")}` : `Search the web for “${pathOf("query")}”`,
        why: "This reaches the network and returns untrusted content.",
        paths: [],
      });
    case "Agent": {
      const kind = pathOf("subagent_type") || "explore";
      const readOnly = kind === "explore" || kind === "plan";
      return op({
        tool: name,
        risk: readOnly ? "safe" : "edit",
        summary: `Spawn ${kind} agent: ${pathOf("description") || "subtask"}`,
        why: readOnly
          ? "A read-only subagent inspects the workspace and cannot edit it."
          : "A general subagent may edit files. Each nested action is still permission-checked.",
        paths: [],
      });
    }
    case "TaskStop":
      return op({
        tool: name,
        risk: "shell",
        summary: `Stop process ${pathOf("task_id")}`,
        why: "Stopping a process interrupts work the agent started.",
        paths: [],
      });
    default:
      return op({
        tool: name,
        risk: "shell",
        summary: `Run ${name}`,
        why: "Unknown tools are treated as privileged.",
        paths: [],
      });
  }
}

function summaryFor(name: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
  switch (name) {
    case "Read":
      return `Read ${file}`;
    case "Write":
      return `Write ${file}`;
    case "Edit":
      return `Edit ${file}`;
    case "LS":
      return `List ${file || "workspace root"}`;
    case "Glob":
      return `Find files matching ${String(input.pattern ?? "")}`;
    case "Grep":
      return `Search for ${String(input.pattern ?? "")}`;
    case "GitStatus":
      return "Show git status";
    case "GitDiff":
      return "Show git diff";
    case "GitLog":
      return "Show git log";
    case "TodoWrite":
      return "Update the task plan";
    case "Skill":
      return `Load skill ${String(input.skill ?? "")}`;
    case "ReportFindings":
      return "Record review findings";
    case "NotebookEdit":
      return `Edit notebook ${String(input.notebook_path ?? "")}`;
    default:
      return name;
  }
}

function whyFor(name: string, input: Record<string, unknown>): string {
  if (name === "Write" || name === "Edit" || name === "NotebookEdit") {
    return "The agent wants to change file contents as part of the current task.";
  }
  if (typeof input.description === "string" && input.description.trim()) return input.description.trim();
  return "Needed to inspect or update the workspace for the current task.";
}
