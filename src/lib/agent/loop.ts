import { createId } from "@/lib/id";
import { compactMessages } from "@/lib/agent/context";
import { phaseForTool } from "@/lib/agent/phases";
import type { AgentEvent, Phase, TodoItem } from "@/lib/events/types";
import type { ModelMessage, ModelStreamEvent, ModelTransport } from "@/lib/model/types";
import { ModelError } from "@/lib/model/types";
import { decide, operationSignature, PermissionGate } from "@/lib/permissions/engine";
import type { PermissionMode, SessionRule } from "@/lib/permissions/types";
import { ToolInputError, type ToolContext, type ToolRegistry, type ToolResult } from "@/lib/tools/registry";
import { truncateMiddle } from "@/lib/tools/truncate";
import type { WorkspacePort } from "@/lib/workspace/types";

export interface PermissionAnswer {
  granted: boolean;
  remember: boolean;
  reason?: string;
}

export interface AgentLoopOptions {
  model: ModelTransport;
  registry: ToolRegistry;
  workspace: WorkspacePort;
  mode: PermissionMode;
  getMode?: () => PermissionMode;
  sessionRules: SessionRule[];
  denyPatterns: string[];
  emit: (event: AgentEvent) => void;
  requestPermission: (request: Extract<AgentEvent, { type: "permission_requested" }>) => Promise<PermissionAnswer>;
  requestClarification: (
    request: Extract<AgentEvent, { type: "clarification_requested" }>,
  ) => Promise<Record<string, string> | null>;
  signal: AbortSignal;
  modelId: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations: number;
  outputLimit: number;
  systemPrompt: string;
  history: ModelMessage[];
  userText: string;
  images?: { mediaType: string; dataUrl: string }[];
  toolAllowlist?: string[];
  depth?: number;
  readState?: Map<string, string>;
  loadSkill: (name: string) => { name: string; body: string } | null;
  spawnAgent?: (input: { description: string; prompt: string; subagentType: string }) => Promise<string>;
  fetchText?: (url: string) => Promise<{ status: number; text: string }>;
}

export interface AgentLoopResult {
  text: string;
  messages: ModelMessage[];
  iterations: number;
  completed: boolean;
  cancelled: boolean;
}

class PermissionDenied extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly tool: string,
    readonly risk: string,
    readonly alreadyEmitted: boolean,
  ) {
    super(message);
    this.name = "PermissionDenied";
  }
}

export async function runAgentTurn(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const depth = options.depth ?? 0;
  const readState = options.readState ?? new Map<string, string>();
  const gate = new PermissionGate();
  const messages: ModelMessage[] = [
    { role: "system", content: options.systemPrompt },
    ...options.history.filter((message) => message.role !== "system"),
    { role: "user", content: options.userText },
  ];
  let finalText = "";
  let cancelled = false;

  if (depth === 0) {
    options.emit({ type: "status_update", phase: "understanding", detail: "Reading the request" });
  }

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    if (options.signal.aborted) {
      cancelled = true;
      options.emit({ type: "cancellation", target: "turn" });
      options.emit({ type: "status_update", phase: "cancelled", detail: "Stopped" });
      return { text: finalText, messages, iterations: iteration, completed: false, cancelled };
    }

    const compacted = compactMessages(messages, 120_000);
    let streamed: Collected;
    try {
      streamed = await streamWithRetry(options, compacted);
    } catch (error) {
      if (options.signal.aborted) {
        cancelled = true;
        options.emit({ type: "cancellation", target: "model" });
        options.emit({ type: "status_update", phase: "cancelled", detail: "Stopped" });
        return { text: finalText, messages, iterations: iteration, completed: false, cancelled };
      }
      const modelError = error instanceof ModelError ? error : new ModelError(error instanceof Error ? error.message : "Model request failed");
      options.emit({
        type: "error",
        id: createId("err"),
        message: modelError.message,
        code: modelError.code,
        retryable: modelError.retryable,
        source: "model",
      });
      options.emit({ type: "status_update", phase: "failed", detail: "The model request failed" });
      return { text: finalText, messages, iterations: iteration, completed: false, cancelled: false };
    }

    if (streamed.text) {
      finalText = streamed.text;
      options.emit({ type: "assistant_message_complete", messageId: streamed.messageId, text: streamed.text });
    }

    if (!streamed.toolCalls.length) {
      if (depth === 0) {
        options.emit({ type: "status_update", phase: "finished", detail: "Finished" });
        options.emit({ type: "task_completion", summary: streamed.text.slice(0, 280) });
      }
      messages.push({ role: "assistant", content: streamed.text });
      return { text: streamed.text, messages, iterations: iteration + 1, completed: true, cancelled: false };
    }

    messages.push({
      role: "assistant",
      content: streamed.text || null,
      tool_calls: streamed.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
      })),
    });

    for (const call of streamed.toolCalls) {
      if (options.signal.aborted) {
        cancelled = true;
        options.emit({ type: "cancellation", target: "turn" });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: { code: "cancelled", message: "The user stopped the turn." } }),
        });
        options.emit({ type: "status_update", phase: "cancelled", detail: "Stopped" });
        return { text: finalText, messages, iterations: iteration + 1, completed: false, cancelled };
      }

      const allow = options.toolAllowlist;
      if (allow && !allow.includes(call.name)) {
        const denied = {
          ok: false,
          error: {
            code: "tool_not_allowed",
            message: `${call.name} is not available to this agent. Allowed: ${allow.join(", ")}`,
          },
        };
        options.emit({
          type: "tool_result",
          toolUseId: call.id,
          name: call.name,
          ok: false,
          isError: true,
          output: denied,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(denied) });
        continue;
      }

      const tool = options.registry.get(call.name);
      options.emit({
        type: "tool_requested",
        toolUseId: call.id,
        name: call.name,
        input: call.input,
        summary: tool ? tool.classify(asRecord(call.input)).summary : call.name,
      });
      if (!tool) {
        const missing = {
          ok: false,
          error: { code: "unknown_tool", message: `Unknown tool ${call.name}. Use one of the provided tools.` },
        };
        options.emit({
          type: "tool_result",
          toolUseId: call.id,
          name: call.name,
          ok: false,
          isError: true,
          output: missing,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(missing) });
        continue;
      }

      const phase = phaseForTool(call.name, asRecord(call.input));
      options.emit({ type: "status_update", phase, detail: tool.classify(asRecord(call.input)).summary });

      let stdout = "";
      let stderr = "";
      const toolCtx: ToolContext = {
        signal: options.signal,
        depth,
        cwd: options.workspace.info()?.root ?? null,
        readState,
        outputLimit: options.outputLimit,
        onStdout(chunk) {
          stdout += chunk;
          options.emit({ type: "tool_stdout", toolUseId: call.id, chunk });
        },
        onStderr(chunk) {
          stderr += chunk;
          options.emit({ type: "tool_stderr", toolUseId: call.id, chunk });
        },
        loadSkill: options.loadSkill,
        fetchText: options.fetchText,
        spawnAgent: options.spawnAgent ?? (async () => "Subagents are not available in this turn."),
        askUser: async (questions) => {
          const questionId = createId("q");
          options.emit({ type: "status_update", phase: "waiting", detail: "Waiting for your answer" });
          const request = {
            type: "clarification_requested" as const,
            questionId,
            toolUseId: call.id,
            questions,
          };
          const answers = await options.requestClarification(request);
          if (answers) options.emit({ type: "clarification_answered", questionId, answers });
          return answers;
        },
        call: (operation, fn) =>
          authorize(options, gate, call.id, operation, fn),
      };

      try {
        const result = await tool.execute(asRecord(call.input), toolCtx);
        publishResult(options, call.id, call.name, result, stdout, stderr);
        if (call.name === "TodoWrite" && isTodoOutput(result.output)) {
          options.emit({ type: "plan_update", todos: result.output.todos });
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: payloadForModel(result),
        });
      } catch (error) {
        if (options.signal.aborted) {
          options.emit({ type: "cancellation", target: "tool", toolUseId: call.id });
          const cancelledPayload = {
            ok: false,
            error: { code: "cancelled", message: "The user stopped this action. Do not repeat it unless they ask." },
          };
          options.emit({
            type: "tool_result",
            toolUseId: call.id,
            name: call.name,
            ok: false,
            isError: true,
            output: cancelledPayload,
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(cancelledPayload) });
          continue;
        }
        const payload = errorPayload(error);
        if (error instanceof PermissionDenied && !error.alreadyEmitted) {
          options.emit({
            type: "permission_denied",
            requestId: createId("perm"),
            toolUseId: call.id,
            reason: error.message,
          });
        }
        options.emit({
          type: "tool_result",
          toolUseId: call.id,
          name: call.name,
          ok: false,
          isError: true,
          output: payload,
        });
        if (!(error instanceof PermissionDenied) && !(error instanceof ToolInputError)) {
          options.emit({
            type: "error",
            id: createId("err"),
            message: error instanceof Error ? error.message : "Tool failed",
            source: "tool",
          });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(payload) });
      }
    }

    options.emit({ type: "status_update", phase: "reviewing", detail: "Reading tool results" });
  }

  const limitMessage = `Stopped after ${options.maxIterations} tool rounds so the turn could not run forever. Ask me to continue if there is more to do.`;
  options.emit({ type: "assistant_text_delta", id: createId("delta"), messageId: createId("msg"), delta: limitMessage });
  options.emit({ type: "assistant_message_complete", messageId: createId("msg"), text: limitMessage });
  options.emit({ type: "status_update", phase: "finished", detail: "Iteration limit reached" });
  messages.push({ role: "assistant", content: limitMessage });
  return { text: limitMessage, messages, iterations: options.maxIterations, completed: false, cancelled: false };
}

async function authorize<T>(
  options: AgentLoopOptions,
  gate: PermissionGate,
  toolUseId: string,
  operation: ReturnType<AgentLoopOptions["registry"]["get"]> extends infer _X ? import("@/lib/permissions/types").Operation : import("@/lib/permissions/types").Operation,
  fn: (workspace: WorkspacePort) => Promise<T>,
): Promise<T> {
  const mode = options.getMode?.() ?? options.mode;
  let decision = decide({
    mode,
    operation,
    sessionRules: options.sessionRules,
    denyPatterns: options.denyPatterns,
  });
  if (decision.decision === "deny") {
    throw new PermissionDenied("permission_denied", decision.reason, operation.tool, operation.risk, false);
  }
  if (decision.decision === "ask") {
    const requestId = createId("perm");
    const request: Extract<AgentEvent, { type: "permission_requested" }> = {
      type: "permission_requested",
      requestId,
      toolUseId,
      name: operation.tool,
      summary: operation.summary,
      why: operation.why,
      paths: operation.paths,
      command: operation.command,
      cwd: operation.cwd ?? options.workspace.info()?.root ?? undefined,
      risk: operation.risk,
      rememberLabel: decision.rememberLabel,
      signature: decision.signature,
    };
    options.emit(request);
    options.emit({ type: "status_update", phase: "waiting", detail: "Waiting for approval" });
    const answer = await options.requestPermission(request);
    if (!answer.granted) {
      options.emit({
        type: "permission_denied",
        requestId,
        toolUseId,
        reason: answer.reason || "You denied this action.",
      });
      throw new PermissionDenied(
        "permission_denied",
        answer.reason || "The user denied this action. Do not retry the same action. Adapt or ask a concise question.",
        operation.tool,
        operation.risk,
        true,
      );
    }
    if (answer.remember) {
      options.sessionRules.push({
        signature: decision.signature,
        decision: "allow",
        label: decision.rememberLabel,
        createdAt: Date.now(),
      });
    } else {
      options.sessionRules.push({
        signature: decision.signature,
        decision: "allow",
        label: "once",
        createdAt: Date.now(),
      });
      // one-shot: removed after this call
    }
    options.emit({
      type: "permission_granted",
      requestId,
      toolUseId,
      scope: answer.remember ? "session" : "once",
    });
    decision = decide({
      mode: options.getMode?.() ?? options.mode,
      operation,
      sessionRules: options.sessionRules,
      denyPatterns: options.denyPatterns,
    });
    if (!answer.remember) {
      const onceIndex = options.sessionRules.findIndex(
        (rule) => rule.signature === operationSignature(operation) && rule.label === "once",
      );
      if (onceIndex >= 0) options.sessionRules.splice(onceIndex, 1);
    }
    if (decision.decision !== "allow") {
      throw new PermissionDenied("permission_denied", decision.reason, operation.tool, operation.risk, false);
    }
  }

  const grant = gate.issue(decision.signature);
  gate.consume(grant, decision.signature);
  options.emit({ type: "tool_started", toolUseId, name: operation.tool });
  return fn(options.workspace);
}

function publishResult(
  options: AgentLoopOptions,
  toolUseId: string,
  name: string,
  result: ToolResult,
  stdout: string,
  stderr: string,
) {
  options.emit({
    type: "tool_result",
    toolUseId,
    name,
    ok: result.ok,
    isError: Boolean(result.isError) || !result.ok,
    output: result.output,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    truncated: result.truncated,
  });
  if (result.diff) {
    options.emit({
      type: "file_diff",
      toolUseId,
      diff: {
        ...result.diff,
        language: result.diff.path.split(".").pop(),
      },
    });
  }
  void stdout;
  void stderr;
}

function payloadForModel(result: ToolResult): string {
  const body = {
    ok: result.ok,
    isError: result.isError ?? !result.ok,
    output: result.output,
    truncated: result.truncated,
    exitCode: result.exitCode,
    diff: result.diff
      ? {
          path: result.diff.path,
          additions: result.diff.additions,
          deletions: result.diff.deletions,
          created: result.diff.created,
          deleted: result.diff.deleted,
          patch: truncateMiddle(result.diff.patch, 8_000).text,
        }
      : undefined,
  };
  return truncateMiddle(JSON.stringify(body), 24_000).text;
}

function errorPayload(error: unknown) {
  if (error instanceof PermissionDenied) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        tool: error.tool,
        risk: error.risk,
      },
    };
  }
  if (error instanceof ToolInputError) {
    return { ok: false, error: { code: "invalid_tool_input", message: error.message } };
  }
  const code =
    typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "tool_error";
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : "Tool failed",
    },
  };
}

interface Collected {
  messageId: string;
  text: string;
  toolCalls: { id: string; name: string; input: unknown }[];
}

async function streamWithRetry(options: AgentLoopOptions, messages: ModelMessage[]): Promise<Collected> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < 3) {
    try {
      return await collect(options, messages, attempt === 0);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ModelError ? error.retryable : isRetryableMessage(error);
      if (!retryable || attempt >= 2 || options.signal.aborted) break;
      attempt += 1;
      options.emit({
        type: "status_update",
        phase: "understanding",
        detail: `Retrying the model request (${attempt}/2)`,
      });
      await delay(400 * attempt, options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new ModelError("Model request failed", "model_error", false);
}

async function collect(options: AgentLoopOptions, messages: ModelMessage[], emitDeltas: boolean): Promise<Collected> {
  const messageId = createId("msg");
  let text = "";
  const toolCalls: Collected["toolCalls"] = [];
  let emitted = false;
  const stream = options.model.streamChat({
    messages,
    tools: options.registry.specs(options.toolAllowlist),
    model: options.modelId,
    provider: options.provider,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal,
    images: options.images,
  });
  for await (const event of stream) {
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    applyStreamEvent(event, {
      onText(delta) {
        text += delta;
        if (emitDeltas) {
          emitted = true;
          options.emit({ type: "assistant_text_delta", id: createId("delta"), messageId, delta });
        }
      },
      onTool(call) {
        toolCalls.push(call);
      },
      onError(error) {
        throw error;
      },
    });
  }
  void emitted;
  return { messageId, text, toolCalls };
}

export function applyStreamEvent(
  event: ModelStreamEvent,
  handlers: {
    onText: (delta: string) => void;
    onTool: (call: { id: string; name: string; input: unknown }) => void;
    onError: (error: ModelError) => void;
  },
) {
  if (event.type === "text" && event.text) handlers.onText(event.text);
  if (event.type === "tool_use") {
    handlers.onTool({ id: event.id || createId("tool"), name: event.name, input: event.input ?? {} });
  }
  if (event.type === "error") {
    handlers.onError(new ModelError(event.message, event.code, event.retryable));
  }
}

function isRetryableMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /overloaded|rate.?limit|timeout|temporar|503|502|429|network/i.test(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isTodoOutput(output: unknown): output is { todos: TodoItem[] } {
  return Boolean(output && typeof output === "object" && "todos" in output && Array.isArray((output as { todos: unknown }).todos));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export function phaseAfterTools(hasMore: boolean): Phase {
  return hasMore ? "reviewing" : "finished";
}
