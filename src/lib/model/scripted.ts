import type { ChatRequest, ModelInfo, ModelStreamEvent, ModelTransport } from "@/lib/model/types";

export interface ScriptedTurn {
  text?: string;
  tools?: { name: string; input: unknown; id?: string }[];
  error?: string;
  retryable?: boolean;
}

export type ScriptedStep = ScriptedTurn | ((request: ChatRequest, turn: number) => ScriptedTurn);

export class ScriptedModel implements ModelTransport {
  readonly name = "scripted";
  calls = 0;

  constructor(private readonly steps: ScriptedStep[]) {}

  async listProviders() {
    return ["scripted"];
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "scripted-1",
        provider: "scripted",
        name: "Scripted",
        aliases: [],
        capabilities: ["tools"],
      },
    ];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ModelStreamEvent> {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)];
    this.calls += 1;
    const resolved = typeof step === "function" ? step(request, this.calls) : step;
    if (!resolved) {
      yield { type: "text", text: "No scripted step." };
      yield { type: "done" };
      return;
    }
    if (resolved.error) {
      yield { type: "error", message: resolved.error, retryable: resolved.retryable };
      return;
    }
    if (request.signal.aborted) return;
    if (resolved.text) yield { type: "text", text: resolved.text };
    for (const tool of resolved.tools ?? []) {
      yield { type: "tool_use", id: tool.id ?? `call_${this.calls}_${tool.name}`, name: tool.name, input: tool.input };
    }
    yield { type: "done" };
  }
}
