import type { Phase } from "@/lib/events/types";
import { looksLikeTestCommand } from "@/lib/safety/commands";

export const PHASE_LABEL: Record<Phase, string> = {
  understanding: "Understanding request",
  inspecting: "Inspecting workspace",
  planning: "Planning",
  editing: "Editing files",
  running: "Running commands",
  testing: "Running tests",
  reviewing: "Reviewing results",
  waiting: "Waiting for you",
  finished: "Finished",
  cancelled: "Cancelled",
  failed: "Needs attention",
};

export function phaseForTool(name: string, input: Record<string, unknown>): Phase {
  if (name === "TodoWrite" || name === "AskUserQuestion") return name === "AskUserQuestion" ? "waiting" : "planning";
  if (name === "Agent") {
    const kind = String(input.subagent_type ?? "explore");
    return kind === "plan" ? "planning" : "inspecting";
  }
  if (name === "Write" || name === "Edit" || name === "Delete" || name === "Move" || name === "NotebookEdit") {
    return "editing";
  }
  if (name === "Bash" || name === "PowerShell" || name === "TaskStop") {
    const command = typeof input.command === "string" ? input.command : "";
    return looksLikeTestCommand(command) ? "testing" : "running";
  }
  if (name === "WebFetch" || name === "WebSearch") return "inspecting";
  return "inspecting";
}
