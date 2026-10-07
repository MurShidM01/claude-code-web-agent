import type { AgentEvent, FileDiffPayload, Phase, TodoItem } from "@/lib/events/types";

export interface UserBlock {
  id: string;
  kind: "user";
  text: string;
  attachments?: { name: string; mediaType: string }[];
}

export interface AssistantBlock {
  id: string;
  kind: "assistant";
  text: string;
  streaming: boolean;
}

export interface ToolBlock {
  id: string;
  kind: "tool";
  toolUseId: string;
  name: string;
  input: unknown;
  summary: string;
  status: "requested" | "running" | "done" | "error" | "denied" | "cancelled";
  stdout: string;
  stderr: string;
  output?: unknown;
  ok?: boolean;
  durationMs?: number;
  exitCode?: number | null;
  truncated?: boolean;
  command?: string;
  cwd?: string;
}

export interface DiffBlock {
  id: string;
  kind: "diff";
  toolUseId: string;
  diff: FileDiffPayload;
}

export interface ErrorBlock {
  id: string;
  kind: "error";
  message: string;
  code?: string;
  source: string;
}

export interface QuestionBlock {
  id: string;
  kind: "question";
  questionId: string;
  toolUseId: string;
  questions: { id: string; prompt: string; options?: string[] }[];
  answers?: Record<string, string>;
}

export interface PlanBlock {
  id: string;
  kind: "plan";
  todos: TodoItem[];
}

export type Block = UserBlock | AssistantBlock | ToolBlock | DiffBlock | ErrorBlock | QuestionBlock | PlanBlock;

export interface TranscriptState {
  blocks: Block[];
  phase: Phase;
  phaseDetail: string;
}

export function emptyTranscript(): TranscriptState {
  return { blocks: [], phase: "understanding", phaseDetail: "Ready" };
}

export function reduceEvent(state: TranscriptState, event: AgentEvent): TranscriptState {
  switch (event.type) {
    case "user_message":
      return {
        ...state,
        phase: "understanding",
        phaseDetail: "Reading the request",
        blocks: [
          ...state.blocks,
          {
            id: event.id,
            kind: "user",
            text: event.text,
            attachments: event.attachments?.map((item) => ({ name: item.name, mediaType: item.mediaType })),
          },
        ],
      };
    case "assistant_text_delta": {
      const blocks = [...state.blocks];
      const index = blocks.findIndex((block) => block.kind === "assistant" && block.id === event.messageId);
      if (index === -1) {
        blocks.push({ id: event.messageId, kind: "assistant", text: event.delta, streaming: true });
      } else {
        const current = blocks[index] as AssistantBlock;
        blocks[index] = { ...current, text: current.text + event.delta, streaming: true };
      }
      return { ...state, blocks };
    }
    case "assistant_message_complete": {
      const blocks = state.blocks.map((block) =>
        block.kind === "assistant" && block.id === event.messageId ? { ...block, text: event.text, streaming: false } : block,
      );
      const exists = state.blocks.some((block) => block.kind === "assistant" && block.id === event.messageId);
      return {
        ...state,
        blocks: exists ? blocks : [...blocks, { id: event.messageId, kind: "assistant", text: event.text, streaming: false }],
      };
    }
    case "tool_requested":
      return {
        ...state,
        blocks: [
          ...state.blocks,
          {
            id: event.toolUseId,
            kind: "tool",
            toolUseId: event.toolUseId,
            name: event.name,
            input: event.input,
            summary: event.summary,
            status: "requested",
            stdout: "",
            stderr: "",
            command: commandOf(event.input),
            cwd: cwdOf(event.input),
          },
        ],
      };
    case "tool_started":
      return { ...state, blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({ ...tool, status: "running" })) };
    case "tool_stdout":
      return {
        ...state,
        blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({ ...tool, stdout: tool.stdout + event.chunk, status: "running" })),
      };
    case "tool_stderr":
      return {
        ...state,
        blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({ ...tool, stderr: tool.stderr + event.chunk })),
      };
    case "tool_result":
      return {
        ...state,
        blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({
          ...tool,
          status: event.ok ? "done" : event.isError ? "error" : "done",
          output: event.output,
          ok: event.ok,
          durationMs: event.durationMs,
          exitCode: event.exitCode,
          truncated: event.truncated,
        })),
      };
    case "permission_denied":
      return {
        ...state,
        blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({ ...tool, status: "denied" })),
      };
    case "cancellation":
      if (!event.toolUseId) return { ...state, phase: "cancelled", phaseDetail: "Stopped" };
      return {
        ...state,
        phase: "cancelled",
        phaseDetail: "Stopped",
        blocks: mapTool(state.blocks, event.toolUseId, (tool) => ({ ...tool, status: tool.status === "done" ? tool.status : "cancelled" })),
      };
    case "file_diff":
      return {
        ...state,
        blocks: [...state.blocks, { id: `diff_${event.toolUseId}_${event.diff.path}`, kind: "diff", toolUseId: event.toolUseId, diff: event.diff }],
      };
    case "plan_update": {
      const without = state.blocks.filter((block) => block.kind !== "plan");
      return { ...state, phase: "planning", phaseDetail: "Updated the plan", blocks: [...without, { id: "plan", kind: "plan", todos: event.todos }] };
    }
    case "status_update":
      return { ...state, phase: event.phase, phaseDetail: event.detail };
    case "error":
      return {
        ...state,
        phase: event.source === "model" ? "failed" : state.phase,
        blocks: [...state.blocks, { id: event.id, kind: "error", message: event.message, code: event.code, source: event.source }],
      };
    case "clarification_requested":
      return {
        ...state,
        phase: "waiting",
        phaseDetail: "Waiting for your answer",
        blocks: [
          ...state.blocks,
          {
            id: event.questionId,
            kind: "question",
            questionId: event.questionId,
            toolUseId: event.toolUseId,
            questions: event.questions,
          },
        ],
      };
    case "clarification_answered":
      return {
        ...state,
        blocks: state.blocks.map((block) =>
          block.kind === "question" && block.questionId === event.questionId ? { ...block, answers: event.answers } : block,
        ),
      };
    case "task_completion":
      return { ...state, phase: "finished", phaseDetail: "Finished" };
    default:
      return state;
  }
}

function mapTool(blocks: Block[], toolUseId: string, update: (tool: ToolBlock) => ToolBlock): Block[] {
  return blocks.map((block) => (block.kind === "tool" && block.toolUseId === toolUseId ? update(block) : block));
}

function commandOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

function cwdOf(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const cwd = (input as { cwd?: unknown }).cwd;
  return typeof cwd === "string" ? cwd : undefined;
}
