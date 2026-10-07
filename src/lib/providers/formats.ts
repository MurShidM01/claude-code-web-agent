import type { ChatRequest, ModelMessage, ModelStreamEvent, ModelToolSpec } from "@/lib/model/types";
import type { EndpointStyle, ProviderAccount, ResolvedCapabilities } from "@/lib/providers/types";
import { isSafeProviderUrl, joinChatUrl } from "@/lib/providers/discover";

export type WireStyle = Exclude<EndpointStyle, "auto"> | "kiro";

export interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  style: WireStyle;
}

const ANTHROPIC_VERSION = "2023-06-01";

export function buildUpstreamCall(account: ProviderAccount, request: ChatRequest, caps: ResolvedCapabilities): UpstreamCall {
  if (account.kind === "kiro") return buildKiroCall(account, request, caps);
  if (account.kind === "openai-codex") return buildCodexCall(account, request, caps);
  const style = account.detectedEndpoint || (account.endpoint && account.endpoint !== "auto" ? account.endpoint : "chat-completions");
  const base = account.apiBase || account.baseUrl || "";
  if (!base) throw new Error("This provider has no base URL.");
  const url = joinChatUrl(base, style);
  if (!isSafeProviderUrl(url, true)) throw new Error("That provider URL is not allowed.");
  if (style === "messages") return { url, style, headers: anthropicHeaders(account), body: anthropicBody(request, caps) };
  if (style === "responses") return { url, style, headers: bearerHeaders(account, true), body: responsesBody(request, caps, false) };
  return { url, style, headers: bearerHeaders(account, false), body: chatCompletionsBody(request, caps) };
}

export function kiroServiceUrl(account: ProviderAccount, path: string): string {
  const region = account.region || "us-east-1";
  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error("Kiro region should look like us-east-1.");
  return `https://q.${region}.amazonaws.com/${path.replace(/^\//, "")}`;
}

function buildCodexCall(account: ProviderAccount, request: ChatRequest, caps: ResolvedCapabilities): UpstreamCall {
  const base = (account.apiBase || "https://chatgpt.com/backend-api/codex").replace(/\/$/, "");
  const url = /\/responses$/.test(base) ? base : `${base}/responses`;
  if (!isSafeProviderUrl(url)) throw new Error("The Codex API URL is not allowed.");
  return {
    url,
    style: "responses",
    headers: {
      ...bearerHeaders(account, true),
      ...(account.accountId ? { "chatgpt-account-id": account.accountId } : {}),
      originator: "kiln",
    },
    body: responsesBody(request, caps, true),
  };
}

function buildKiroCall(account: ProviderAccount, request: ChatRequest, caps: ResolvedCapabilities): UpstreamCall {
  if (!account.accessToken) throw new Error("Kiro is not signed in.");
  return {
    url: kiroServiceUrl(account, "generateAssistantResponse"),
    style: "kiro",
    headers: {
      authorization: `Bearer ${account.accessToken}`,
      "content-type": "application/json",
      accept: "application/json, application/vnd.amazon.eventstream",
      "x-amz-user-agent": "aws-sdk-js/3.0.0 KiroIDE",
    },
    body: kiroBody(request, caps),
  };
}

function bearerHeaders(account: ProviderAccount, sse: boolean): Record<string, string> {
  const token = account.accessToken || account.apiKey;
  if (!token) throw new Error(`${account.label} has no API key or access token.`);
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: sse ? "text/event-stream, application/json" : "application/json",
  };
}

function anthropicHeaders(account: ProviderAccount): Record<string, string> {
  const token = account.apiKey || account.accessToken;
  if (!token) throw new Error(`${account.label} has no API key.`);
  return {
    "x-api-key": token,
    authorization: `Bearer ${token}`,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
    accept: "text/event-stream, application/json",
  };
}

function chatCompletionsBody(request: ChatRequest, caps: ResolvedCapabilities) {
  return {
    model: request.model,
    messages: request.messages.map((message) => chatMessage(message, request.images, caps.vision)),
    ...(caps.tools && request.tools.length ? { tools: request.tools.map(openAiTool), tool_choice: "auto" } : {}),
    stream: caps.streaming,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(caps.reasoning ? { reasoning_effort: request.reasoningEffort || caps.reasoningEffort || "medium" } : {}),
  };
}

function responsesBody(request: ChatRequest, caps: ResolvedCapabilities, codex: boolean) {
  const instructions = request.messages.filter((message) => message.role === "system").map((message) => message.content || "").filter(Boolean).join("\n\n");
  const input = request.messages.filter((message) => message.role !== "system").flatMap((message) => responsesInput(message, request.images, caps.vision));
  return {
    model: request.model,
    instructions: instructions || undefined,
    input,
    ...(caps.tools && request.tools.length ? { tools: request.tools.map(responsesTool), tool_choice: "auto" } : {}),
    stream: caps.streaming,
    store: false,
    ...(request.temperature != null && !codex ? { temperature: request.temperature } : {}),
    ...(request.maxTokens ? { max_output_tokens: request.maxTokens } : {}),
    ...(caps.reasoning
      ? { reasoning: { effort: request.reasoningEffort || caps.reasoningEffort || "medium", summary: "auto" } }
      : {}),
  };
}

function anthropicBody(request: ChatRequest, caps: ResolvedCapabilities) {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content || "").filter(Boolean).join("\n\n");
  const maxTokens = request.maxTokens || 4096;
  return {
    model: request.model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: anthropicMessages(request.messages, request.images, caps.vision),
    ...(caps.tools && request.tools.length ? { tools: request.tools.map(anthropicTool) } : {}),
    stream: caps.streaming,
    ...(request.temperature != null ? { temperature: request.temperature } : {}),
    ...(caps.reasoning && maxTokens > 1024
      ? { thinking: { type: "enabled", budget_tokens: Math.min(8192, Math.floor(maxTokens / 2)) } }
      : {}),
  };
}

function kiroBody(request: ChatRequest, caps: ResolvedCapabilities) {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content || "").filter(Boolean).join("\n\n");
  const history: unknown[] = [];
  const conversational = request.messages.filter((message) => message.role !== "system");
  let pendingTools: { toolUseId: string; name: string; input: unknown }[] = [];
  for (let index = 0; index < conversational.length; index += 1) {
    const message = conversational[index]!;
    const last = index === conversational.length - 1;
    if (message.role === "assistant") {
      pendingTools = (message.tool_calls ?? []).map((call) => ({
        toolUseId: call.id,
        name: call.function.name,
        input: parseMaybe(call.function.arguments),
      }));
      if (!last) {
        history.push({
          assistantResponseMessage: {
            content: message.content || "",
            ...(pendingTools.length ? { toolUses: pendingTools } : {}),
          },
        });
      }
      continue;
    }
    if (message.role === "tool") {
      continue;
    }
    const toolResults = toolResultsBefore(conversational, index);
    const turn = kiroUser(message.content || "", request.model, caps, last ? request.images : undefined, last ? request.tools : undefined, toolResults, last ? system : undefined);
    if (last) {
      return {
        conversationState: {
          chatTriggerType: "MANUAL",
          conversationId: randomId(),
          currentMessage: { userInputMessage: turn },
          history,
        },
      };
    }
    history.push({ userInputMessage: turn });
  }
  const turn = kiroUser(system || "Continue.", request.model, caps, request.images, request.tools, [], undefined);
  return {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: randomId(),
      currentMessage: { userInputMessage: turn },
      history,
    },
  };
}

function kiroUser(
  content: string,
  modelId: string,
  caps: ResolvedCapabilities,
  images: ChatRequest["images"],
  tools: ModelToolSpec[] | undefined,
  toolResults: { toolUseId: string; content: { text: string }[]; status: "success" | "error" }[],
  system: string | undefined,
) {
  const joined = system ? `${system}\n\n${content}` : content;
  const text = caps.reasoning && !joined.includes("<thinking_mode>") ? `<thinking_mode>enabled</thinking_mode>\n${joined}` : joined;
  const context: Record<string, unknown> = {};
  if (caps.tools && tools?.length) {
    context.tools = tools.map((tool) => ({
      toolSpecification: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: tool.parameters },
      },
    }));
  }
  if (toolResults.length) context.toolResults = toolResults;
  return {
    content: text,
    modelId,
    origin: "AI_EDITOR",
    ...(caps.vision && images?.length
      ? {
          images: images.slice(0, 4).map((image) => ({
            format: imageFormat(image.mediaType),
            source: { bytes: dataUrlPayload(image.dataUrl) },
          })),
        }
      : {}),
    ...(Object.keys(context).length ? { userInputMessageContext: context } : {}),
  };
}

function toolResultsBefore(messages: ModelMessage[], userIndex: number) {
  const results: { toolUseId: string; content: { text: string }[]; status: "success" | "error" }[] = [];
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" || message.role === "assistant") break;
    if (message.role === "tool" && message.tool_call_id) {
      results.unshift({
        toolUseId: message.tool_call_id,
        content: [{ text: message.content || "" }],
        status: /"ok":false|"isError":true/i.test(message.content || "") ? "error" : "success",
      });
    }
  }
  return results;
}

function chatMessage(message: ModelMessage, images: ChatRequest["images"], vision: boolean) {
  if (message.role === "assistant" && message.tool_calls?.length) {
    return { role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls };
  }
  if (message.role === "tool") return { role: "tool", tool_call_id: message.tool_call_id, content: message.content ?? "" };
  if (message.role === "user" && vision && images?.length && typeof message.content === "string") {
    return {
      role: "user",
      content: [
        { type: "text", text: message.content },
        ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
      ],
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

function responsesInput(message: ModelMessage, images: ChatRequest["images"], vision: boolean): unknown[] {
  if (message.role === "assistant" && message.tool_calls?.length) {
    const items: unknown[] = [];
    if (message.content) items.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
    for (const call of message.tool_calls) {
      items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return items;
  }
  if (message.role === "tool") {
    return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content ?? "" }];
  }
  if (message.role === "user" && vision && images?.length) {
    return [{
      role: "user",
      content: [
        { type: "input_text", text: message.content || "" },
        ...images.map((image) => ({ type: "input_image", image_url: image.dataUrl })),
      ],
    }];
  }
  return [{ role: message.role === "assistant" ? "assistant" : "user", content: message.content || "" }];
}

function anthropicMessages(messages: ModelMessage[], images: ChatRequest["images"], vision: boolean) {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.function.name, input: parseMaybe(call.function.arguments) });
      }
      out.push({ role: "assistant", content: content.length ? content : "" });
      continue;
    }
    if (message.role === "tool") {
      const last = out[out.length - 1] as { role?: string; content?: unknown[] } | undefined;
      const block = { type: "tool_result", tool_use_id: message.tool_call_id, content: message.content || "" };
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }
    if (vision && images?.length) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: message.content || "" },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: dataUrlPayload(image.dataUrl) },
          })),
        ],
      });
      continue;
    }
    out.push({ role: "user", content: message.content || "" });
  }
  return out;
}

function openAiTool(tool: ModelToolSpec) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function responsesTool(tool: ModelToolSpec) {
  return { type: "function", name: tool.name, description: tool.description, parameters: tool.parameters };
}

function anthropicTool(tool: ModelToolSpec) {
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

export class StreamDecoder {
  private buffer = "";
  private tools = new Map<number, { id: string; name: string; args: string }>();
  private emittedTools = new Set<string>();

  constructor(private readonly style: WireStyle) {}

  push(chunk: string): ModelStreamEvent[] {
    this.buffer += chunk;
    if (this.style === "kiro" && this.buffer.charCodeAt(0) !== undefined && !this.buffer.trimStart().startsWith("{") && !this.buffer.includes("data:")) {
      return this.drainEventStream();
    }
    return this.drainSse();
  }

  finish(raw?: string): ModelStreamEvent[] {
    if (raw && !this.buffer) this.buffer = raw;
    const events = this.buffer.includes("data:") || this.buffer.includes("\n\n") ? this.drainSse(true) : this.parseComplete(this.buffer);
    events.push(...this.flushTools());
    if (!events.some((event) => event.type === "done" || event.type === "error")) events.push({ type: "done" });
    this.buffer = "";
    return events;
  }

  private drainSse(final = false): ModelStreamEvent[] {
    const parts = this.buffer.split(/\n\n/);
    this.buffer = final ? "" : parts.pop() ?? "";
    const events: ModelStreamEvent[] = [];
    for (const part of parts) {
      if (!part.trim()) continue;
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      const eventName = part.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        events.push(...this.flushTools(), { type: "done" });
        continue;
      }
      try {
        events.push(...this.fromRecord(JSON.parse(data) as unknown, eventName));
      } catch {
        // Incomplete JSON is left for the next chunk only when it was not a full SSE block.
      }
    }
    return events;
  }

  private drainEventStream(): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    const bytes = Buffer.from(this.buffer, "binary");
    let offset = 0;
    while (offset + 12 <= bytes.length) {
      const total = bytes.readUInt32BE(offset);
      if (total < 16 || offset + total > bytes.length) break;
      const headersLength = bytes.readUInt32BE(offset + 4);
      const payloadStart = offset + 12 + headersLength;
      const payloadEnd = offset + total - 4;
      if (payloadStart >= 0 && payloadEnd > payloadStart && payloadEnd <= bytes.length) {
        const payload = bytes.subarray(payloadStart, payloadEnd).toString("utf8");
        if (payload.trim()) {
          try {
            events.push(...this.fromRecord(JSON.parse(payload) as unknown));
          } catch {
            // Non-JSON prelude frames are ignored.
          }
        }
      }
      offset += total;
    }
    this.buffer = bytes.subarray(offset).toString("binary");
    return events;
  }

  parseComplete(raw: string): ModelStreamEvent[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return this.fromRecord(JSON.parse(trimmed) as unknown);
    } catch {
      return [{ type: "error", message: trimmed.slice(0, 500), retryable: /429|503|timeout|temporar/i.test(trimmed) }];
    }
  }

  fromRecord(value: unknown, eventName?: string): ModelStreamEvent[] {
    const record = asRecord(value);
    if (!record) return [];
    if (this.style === "messages") return this.fromAnthropic(record, eventName);
    if (this.style === "kiro") return this.fromKiro(record);
    if (this.style === "responses") return this.fromResponses(record, eventName);
    return this.fromChat(record);
  }

  private fromChat(record: Record<string, unknown>): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    const choice = Array.isArray(record.choices) ? asRecord(record.choices[0]) : null;
    const delta = asRecord(choice?.delta) || asRecord(choice?.message) || asRecord(record.delta);
    const text = typeof delta?.content === "string" ? delta.content : "";
    if (text) events.push({ type: "text", text });
    const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : typeof delta?.reasoning === "string" ? delta.reasoning : "";
    if (reasoning) events.push({ type: "reasoning", text: reasoning });
    const toolCalls = delta?.tool_calls || choice?.message && asRecord(choice.message)?.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) this.absorbTool(call);
    }
    if (choice?.finish_reason) events.push(...this.flushTools());
    const error = asRecord(record.error);
    if (error && typeof error.message === "string") {
      events.push({ type: "error", message: error.message, code: typeof error.code === "string" ? error.code : undefined, retryable: /429|503|timeout|rate/i.test(error.message) });
    }
    return events;
  }

  private fromResponses(record: Record<string, unknown>, eventName?: string): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    const type = eventName || (typeof record.type === "string" ? record.type : "");
    if (type === "response.output_text.delta" && typeof record.delta === "string") events.push({ type: "text", text: record.delta });
    if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && typeof record.delta === "string") {
      events.push({ type: "reasoning", text: record.delta });
    }
    const item = asRecord(record.item) || asRecord(record.output_item);
    if (item?.type === "function_call" && typeof item.name === "string") {
      events.push(toolEvent(String(item.call_id || item.id || ""), item.name, item.arguments));
    }
    if (Array.isArray(record.output)) {
      for (const part of record.output) events.push(...this.fromResponses(asRecord(part) || {}, "response.output_item.done"));
    }
    const response = asRecord(record.response);
    if (response?.output) events.push(...this.fromResponses(response));
    if (type === "response.completed" || type === "response.failed") events.push({ type: "done" });
    const error = asRecord(record.error);
    if (error && typeof error.message === "string") events.push({ type: "error", message: error.message, retryable: /429|503|timeout|rate/i.test(error.message) });
    return events;
  }

  private fromAnthropic(record: Record<string, unknown>, eventName?: string): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    const type = eventName || (typeof record.type === "string" ? record.type : "");
    if (type === "content_block_start") {
      const block = asRecord(record.content_block);
      const index = typeof record.index === "number" ? record.index : 0;
      if (block?.type === "tool_use") {
        this.tools.set(index, { id: String(block.id || ""), name: String(block.name || ""), args: "" });
      }
    }
    if (type === "content_block_delta") {
      const delta = asRecord(record.delta);
      const index = typeof record.index === "number" ? record.index : 0;
      if (delta?.type === "text_delta" && typeof delta.text === "string") events.push({ type: "text", text: delta.text });
      if ((delta?.type === "thinking_delta" || delta?.type === "reasoning_delta") && typeof delta.thinking === "string") {
        events.push({ type: "reasoning", text: delta.thinking });
      }
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const current = this.tools.get(index) ?? { id: "", name: "", args: "" };
        current.args += delta.partial_json;
        this.tools.set(index, current);
      }
    }
    if (type === "content_block_stop") events.push(...this.flushTools());
    if (type === "message_stop") events.push({ type: "done" });
    if (Array.isArray(record.content)) {
      for (const block of record.content) {
        const part = asRecord(block);
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string") events.push({ type: "text", text: part.text });
        if (part.type === "thinking" && typeof part.thinking === "string") events.push({ type: "reasoning", text: part.thinking });
        if (part.type === "tool_use") events.push(toolEvent(String(part.id || ""), String(part.name || ""), part.input));
      }
    }
    const error = asRecord(record.error);
    if (error && typeof error.message === "string") events.push({ type: "error", message: error.message, retryable: /429|529|503|overloaded|rate/i.test(error.message) });
    return events;
  }

  private fromKiro(record: Record<string, unknown>): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    const assistant = asRecord(record.assistantResponseEvent) || asRecord(record.assistantResponseMessage);
    if (assistant && typeof assistant.content === "string" && assistant.content) events.push({ type: "text", text: assistant.content });
    const tool = asRecord(record.toolUseEvent) || asRecord(record.toolUse);
    if (tool && typeof tool.name === "string") events.push(toolEvent(String(tool.toolUseId || tool.id || ""), tool.name, tool.input ?? tool.arguments));
    if (Array.isArray(assistant?.toolUses)) {
      for (const item of assistant.toolUses) {
        const use = asRecord(item);
        if (use && typeof use.name === "string") events.push(toolEvent(String(use.toolUseId || ""), use.name, use.input));
      }
    }
    const error = asRecord(record.error) || asRecord(record.message);
    if (typeof record.message === "string" && /error|exception/i.test(record.message)) {
      events.push({ type: "error", message: record.message, retryable: /throttl|timeout|temporar/i.test(record.message) });
    } else if (error && typeof error.message === "string") {
      events.push({ type: "error", message: error.message });
    }
    return events;
  }

  private absorbTool(value: unknown) {
    const call = asRecord(value);
    if (!call) return;
    const index = typeof call.index === "number" ? call.index : this.tools.size;
    const fn = asRecord(call.function);
    const current = this.tools.get(index) ?? { id: "", name: "", args: "" };
    if (typeof call.id === "string" && call.id) current.id = call.id;
    if (typeof fn?.name === "string") current.name += fn.name;
    if (typeof fn?.arguments === "string") current.args += fn.arguments;
    if (!fn && typeof call.name === "string") current.name = call.name;
    this.tools.set(index, current);
  }

  private flushTools(): ModelStreamEvent[] {
    const events: ModelStreamEvent[] = [];
    for (const [index, tool] of this.tools) {
      if (!tool.name) continue;
      const key = tool.id || `${index}:${tool.name}:${tool.args}`;
      if (this.emittedTools.has(key)) continue;
      this.emittedTools.add(key);
      events.push(toolEvent(tool.id || `call_${index}`, tool.name, tool.args));
    }
    this.tools.clear();
    return events;
  }
}

export function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || `The provider returned ${status}.`;
  } catch {
    return body.trim().slice(0, 400) || `The provider returned ${status}.`;
  }
}

function toolEvent(id: string, name: string, args: unknown): ModelStreamEvent {
  return { type: "tool_use", id: id || `call_${name}`, name, input: parseMaybe(args) };
}

function parseMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value ? { _raw: value } : {};
  }
}

function dataUrlPayload(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function imageFormat(mediaType: string): string {
  if (mediaType.includes("png")) return "png";
  if (mediaType.includes("gif")) return "gif";
  if (mediaType.includes("webp")) return "webp";
  return "jpeg";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}
