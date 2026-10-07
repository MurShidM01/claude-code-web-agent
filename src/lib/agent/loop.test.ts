import { describe, expect, it } from "vitest";
import { runAgentTurn } from "@/lib/agent/loop";
import { reduceEvent } from "@/lib/events/reducer";
import { emptyTranscript } from "@/lib/events/reducer";
import type { AgentEvent } from "@/lib/events/types";
import { ScriptedModel } from "@/lib/model/scripted";
import { createToolRegistry } from "@/lib/tools/builtins";
import { MemoryWorkspace } from "@/lib/workspace/memory";

function harness(model: ScriptedModel, mode: "ask" | "auto-edit" | "full" = "full") {
  const workspace = new MemoryWorkspace("/workspace");
  workspace.seed("src/math.js", "export function multiply(a, b) {\n  return a + b;\n}\n");
  const events: AgentEvent[] = [];
  let transcript = emptyTranscript();
  const answers: { granted: boolean; remember: boolean }[] = [];
  const pending: Promise<{ granted: boolean; remember: boolean }>[] = [];
  const controller = new AbortController();
  const done = runAgentTurn({
    model,
    registry: createToolRegistry(),
    workspace,
    mode,
    sessionRules: [],
    denyPatterns: [],
    emit: (event) => {
      events.push(event);
      transcript = reduceEvent(transcript, event);
    },
    requestPermission: () => {
      const next = answers.shift() ?? { granted: true, remember: false };
      return Promise.resolve(next);
    },
    requestClarification: async () => ({ q: "use the bridge" }),
    signal: controller.signal,
    modelId: "scripted-1",
    maxIterations: 6,
    outputLimit: 8000,
    systemPrompt: "test",
    history: [],
    userText: "fix multiply",
    loadSkill: (name) => (name === "demo" ? { name, body: "Do the demo carefully." } : null),
    spawnAgent: async () => "explored src/math.js",
  });
  return { workspace, events, done, controller, answers, pending, transcript: () => transcript };
}

describe("agent loop", () => {
  it("reads, edits, and finishes with a real diff", async () => {
    const model = new ScriptedModel([
      { tools: [{ name: "Read", input: { file_path: "src/math.js" } }] },
      {
        tools: [
          {
            name: "Edit",
            input: { file_path: "src/math.js", old_string: "return a + b;", new_string: "return a * b;" },
          },
        ],
      },
      { text: "Fixed multiply to use multiplication." },
    ]);
    const run = harness(model, "auto-edit");
    const result = await run.done;
    expect(result.completed).toBe(true);
    expect(workspaceText(run.workspace)).toContain("return a * b;");
    expect(run.events.some((event) => event.type === "file_diff")).toBe(true);
    expect(run.events.some((event) => event.type === "task_completion")).toBe(true);
    expect(run.transcript().blocks.some((block) => block.kind === "assistant" && block.text.includes("Fixed"))).toBe(true);
  });

  it("returns a structured denial and lets the model adapt", async () => {
    const model = new ScriptedModel([
      { tools: [{ name: "Bash", input: { command: "npm test", description: "Run tests" } }] },
      { text: "I could not run the tests because the command was denied." },
    ]);
    const run = harness(model, "ask");
    run.answers.push({ granted: false, remember: false });
    const result = await run.done;
    expect(result.completed).toBe(true);
    expect(run.events.some((event) => event.type === "permission_denied")).toBe(true);
    const toolMessage = result.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("permission_denied");
    expect(result.text).toContain("denied");
  });

  it("asks before shell in auto-edit and records a session allow", async () => {
    const model = new ScriptedModel([
      { tools: [{ name: "Bash", input: { command: "npm test", description: "Run tests" } }] },
      { text: "The command could not actually execute in the memory workspace." },
    ]);
    const run = harness(model, "auto-edit");
    run.answers.push({ granted: true, remember: true });
    await run.done;
    expect(run.events.some((event) => event.type === "permission_requested")).toBe(true);
    expect(run.events.some((event) => event.type === "permission_granted")).toBe(true);
  });

  it("cancels an in-flight turn", async () => {
    const model = new ScriptedModel([
      {
        text: "starting",
        tools: [{ name: "Read", input: { file_path: "src/math.js" } }],
      },
      { text: "should not get here" },
    ]);
    const run = harness(model, "full");
    const resultPromise = run.done;
    run.controller.abort();
    const result = await resultPromise;
    expect(result.cancelled || run.events.some((event) => event.type === "cancellation")).toBe(true);
  });

  it("retries a transient model error once", async () => {
    let failed = false;
    const model = new ScriptedModel([
      (request) => {
        void request;
        if (!failed) {
          failed = true;
          return { error: "overloaded", retryable: true };
        }
        return { text: "Recovered." };
      },
    ]);
    const run = harness(model, "full");
    const result = await run.done;
    expect(result.text).toBe("Recovered.");
    expect(model.calls).toBeGreaterThan(1);
  });

  it("stops the turn when the model repeats the same failing call", async () => {
    const failingEdit = {
      name: "Edit",
      input: { file_path: "src/math.js", old_string: "does not exist", new_string: "x" },
    };
    const model = new ScriptedModel([
      { tools: [failingEdit] },
      { tools: [failingEdit] },
      { tools: [failingEdit] },
      { text: "This should not be reached." },
    ]);
    const run = harness(model, "auto-edit");
    const result = await run.done;
    expect(result.completed).toBe(false);
    const toolMessages = result.messages.filter((message) => message.role === "tool");
    expect(toolMessages.some((message) => String(message.content ?? "").includes("repeated_failure"))).toBe(true);
    // The third identical call was refused before it executed, and the file
    // was never modified.
    expect(workspaceText(run.workspace)).toContain("return a + b;");
    expect(run.events.some((event) => event.type === "status_update" && event.phase === "failed")).toBe(true);
  });

  it("lets the model recover when a different call succeeds between failures", async () => {
    const failingEdit = {
      name: "Edit",
      input: { file_path: "src/math.js", old_string: "does not exist", new_string: "x" },
    };
    const model = new ScriptedModel([
      { tools: [failingEdit] },
      { tools: [{ name: "Read", input: { file_path: "src/math.js" } }] },
      { tools: [failingEdit] },
      { tools: [failingEdit] },
      { tools: [failingEdit] },
      { text: "Stopped after repeats." },
    ]);
    const run = harness(model, "auto-edit");
    const result = await run.done;
    // One success resets the streak, so the breaker only trips after the
    // three consecutive failures at the end.
    expect(result.completed).toBe(false);
    const toolMessages = result.messages.filter((message) => message.role === "tool");
    expect(toolMessages.filter((message) => String(message.content ?? "").includes("repeated_failure"))).toHaveLength(1);
  });
});

function workspaceText(workspace: MemoryWorkspace): string {
  return workspace.files.get("src/math.js")?.content ?? "";
}
