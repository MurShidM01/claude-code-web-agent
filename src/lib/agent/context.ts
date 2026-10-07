import type { ModelMessage } from "@/lib/model/types";
import { truncateMiddle } from "@/lib/tools/truncate";

const TOOL_KEEP_FULL = 6;
const TOOL_STUB_CHARS = 600;

export function compactMessages(messages: ModelMessage[], maxChars: number): ModelMessage[] {
  const total = messages.reduce((sum, message) => sum + messageSize(message), 0);
  if (total <= maxChars) return messages;
  const toolIndexes = messages
    .map((message, index) => (message.role === "tool" ? index : -1))
    .filter((index) => index >= 0);
  const keep = new Set(toolIndexes.slice(-TOOL_KEEP_FULL));
  return messages.map((message, index) => {
    if (message.role !== "tool" || keep.has(index) || typeof message.content !== "string") return message;
    if (message.content.length <= TOOL_STUB_CHARS) return message;
    const clipped = truncateMiddle(message.content, TOOL_STUB_CHARS);
    return {
      ...message,
      content: `${clipped.text}\n[older tool output compacted to save context]`,
    };
  });
}

function messageSize(message: ModelMessage): number {
  const content = message.content ?? "";
  const calls = message.tool_calls?.reduce((sum, call) => sum + call.function.arguments.length, 0) ?? 0;
  return content.length + calls;
}

export function estimateChars(messages: ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + messageSize(message), 0);
}
