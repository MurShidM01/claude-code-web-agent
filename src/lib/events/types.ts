/**
 * Typed event protocol. The UI is a projection of these events — it does not
 * scrape assistant prose to discover tool activity.
 */

export type Phase =
  | "understanding"
  | "inspecting"
  | "planning"
  | "editing"
  | "running"
  | "testing"
  | "reviewing"
  | "waiting"
  | "finished"
  | "cancelled"
  | "failed";

export type Risk =
  | "safe"
  | "edit"
  | "structure"
  | "shell"
  | "network"
  | "git-write"
  | "install"
  | "critical"
  | "blocked";

export interface FileDiffPayload {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  created: boolean;
  deleted?: boolean;
  language?: string;
  original: string | null;
  next: string | null;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export type AgentEvent =
  | {
      type: "user_message";
      id: string;
      conversationId: string;
      text: string;
      attachments?: { name: string; mediaType: string; text?: string }[];
      createdAt: number;
    }
  | {
      type: "assistant_text_delta";
      id: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant_message_complete";
      messageId: string;
      text: string;
    }
  | {
      type: "tool_requested";
      toolUseId: string;
      name: string;
      input: unknown;
      summary: string;
    }
  | {
      type: "permission_requested";
      requestId: string;
      toolUseId: string;
      name: string;
      summary: string;
      why: string;
      paths: string[];
      command?: string;
      cwd?: string;
      risk: Risk;
      rememberLabel: string;
      signature: string;
    }
  | {
      type: "permission_granted";
      requestId: string;
      toolUseId: string;
      scope: "once" | "session";
    }
  | {
      type: "permission_denied";
      requestId: string;
      toolUseId: string;
      reason: string;
    }
  | { type: "tool_started"; toolUseId: string; name: string }
  | { type: "tool_stdout"; toolUseId: string; chunk: string }
  | { type: "tool_stderr"; toolUseId: string; chunk: string }
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      ok: boolean;
      output: unknown;
      isError: boolean;
      durationMs?: number;
      exitCode?: number | null;
      truncated?: boolean;
    }
  | { type: "file_diff"; toolUseId: string; diff: FileDiffPayload }
  | { type: "plan_update"; todos: TodoItem[] }
  | { type: "status_update"; phase: Phase; detail: string }
  | {
      type: "error";
      id: string;
      message: string;
      code?: string;
      retryable?: boolean;
      source: "model" | "tool" | "bridge" | "auth" | "app";
    }
  | {
      type: "cancellation";
      target: "model" | "tool" | "turn";
      toolUseId?: string;
    }
  | { type: "task_completion"; summary: string }
  | {
      type: "clarification_requested";
      questionId: string;
      toolUseId: string;
      questions: { id: string; prompt: string; options?: string[] }[];
    }
  | {
      type: "clarification_answered";
      questionId: string;
      answers: Record<string, string>;
    };

export interface EventSink {
  emit(event: AgentEvent): void;
}
