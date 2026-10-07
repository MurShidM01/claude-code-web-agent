import type { ModelToolSpec } from "@/lib/model/types";
import type { Operation } from "@/lib/permissions/types";
import type { WorkspacePort } from "@/lib/workspace/types";

export interface ToolResult {
  ok: boolean;
  output: unknown;
  isError?: boolean;
  diff?: {
    path: string;
    additions: number;
    deletions: number;
    patch: string;
    created: boolean;
    deleted?: boolean;
    original: string | null;
    next: string | null;
  };
  exitCode?: number | null;
  durationMs?: number;
  truncated?: boolean;
  processId?: string;
}

export interface ToolContext {
  signal: AbortSignal;
  depth: number;
  cwd: string | null;
  readState: Map<string, string>;
  call<T>(operation: Operation, fn: (workspace: WorkspacePort) => Promise<T>): Promise<T>;
  onStdout(chunk: string): void;
  onStderr(chunk: string): void;
  askUser(
    questions: { id: string; prompt: string; options?: string[] }[],
  ): Promise<Record<string, string> | null>;
  spawnAgent(input: { description: string; prompt: string; subagentType: string }): Promise<string>;
  loadSkill(name: string): { name: string; body: string } | null;
  fetchText?(url: string): Promise<{ status: number; text: string }>;
  outputLimit: number;
}

export interface ToolDefinition {
  spec: ModelToolSpec;
  classify(input: Record<string, unknown>): Operation;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.spec.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(allow?: string[]): ToolDefinition[] {
    const all = [...this.tools.values()];
    if (!allow) return all;
    const wanted = new Set(allow);
    return all.filter((tool) => wanted.has(tool.spec.name));
  }

  specs(allow?: string[]): ModelToolSpec[] {
    return this.list(allow).map((tool) => tool.spec);
  }
}

export function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`${key} is required and must be a non-empty string.`);
  }
  return value;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
