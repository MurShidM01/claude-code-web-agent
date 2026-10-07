"use client";

import { ArrowRight, Bug, Compass, FolderOpen, FolderPlus, GitPullRequest, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AppState } from "@/lib/app/controller";

const EXAMPLES: { title: string; prompt: string; icon: LucideIcon }[] = [
  { title: "Explain this project", prompt: "Explain how this project is structured and which files I should read first.", icon: Compass },
  { title: "Find and fix a bug", prompt: "Find the bug in the sample math module, fix it, and run the tests.", icon: Bug },
  { title: "Review uncommitted work", prompt: "Review the uncommitted changes and summarize the risk.", icon: GitPullRequest },
  { title: "Add validation", prompt: "Add input validation to the public functions and show me the diff.", icon: ShieldCheck },
];

export function EmptyState({ state, onOpenProject }: { state: AppState; onOpenProject: () => void }) {
  const connected = state.workspace.kind !== "none";
  return (
    <div className="empty">
      <h2 suppressHydrationWarning>{greeting()}</h2>
      <p className="lede">
        Kiln reads the project you open, then edits files and runs commands through a local bridge — and shows the diffs and the
        real output instead of describing them.
      </p>

      {connected ? (
        <div className="project-card connected">
          <span className="pc-icon">
            <FolderOpen size={17} aria-hidden />
          </span>
          <span className="pc-text">
            <span className="pc-title">{state.workspace.label}</span>
            <span className="pc-sub">{state.workspace.root}</span>
          </span>
          <button type="button" className="btn" onClick={onOpenProject}>
            Change
          </button>
        </div>
      ) : (
        <div className="project-card">
          <span className="pc-icon">
            <FolderPlus size={17} aria-hidden />
          </span>
          <span className="pc-text">
            <span className="pc-title">No project open</span>
            <span className="pc-sub">
              {state.bridge.status === "connected"
                ? "The bridge is online — choose the folder the agent should work in."
                : "Pick a folder, or start the bridge for shell and git access."}
            </span>
          </span>
          <button type="button" className="btn primary" onClick={onOpenProject}>
            Open project
            <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      )}

      <div className="examples">
        {EXAMPLES.map((example) => {
          const Icon = example.icon;
          return (
            <button
              key={example.title}
              type="button"
              className="example"
              onClick={() => window.dispatchEvent(new CustomEvent("kiln:fill", { detail: example.prompt }))}
            >
              <Icon size={16} aria-hidden />
              <span className="example-text">{example.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
