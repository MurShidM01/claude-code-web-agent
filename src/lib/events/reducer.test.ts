import { describe, expect, it } from "vitest";
import { emptyTranscript, reduceEvent } from "@/lib/events/reducer";

describe("event reducer", () => {
  it("appends streamed text and closes the message", () => {
    let state = emptyTranscript();
    state = reduceEvent(state, { type: "assistant_text_delta", id: "d1", messageId: "m1", delta: "Hello" });
    state = reduceEvent(state, { type: "assistant_text_delta", id: "d2", messageId: "m1", delta: " there" });
    state = reduceEvent(state, { type: "assistant_message_complete", messageId: "m1", text: "Hello there" });
    const block = state.blocks.find((item) => item.kind === "assistant");
    expect(block).toMatchObject({ text: "Hello there", streaming: false });
  });

  it("tracks a command from request through live output to result", () => {
    let state = emptyTranscript();
    state = reduceEvent(state, {
      type: "tool_requested",
      toolUseId: "t1",
      name: "Bash",
      input: { command: "npm test", cwd: "sample-project" },
      summary: "Run tests",
    });
    state = reduceEvent(state, { type: "tool_stdout", toolUseId: "t1", chunk: "ok\n" });
    state = reduceEvent(state, {
      type: "tool_result",
      toolUseId: "t1",
      name: "Bash",
      ok: true,
      isError: false,
      output: { stdout: "ok" },
      durationMs: 40,
      exitCode: 0,
    });
    const tool = state.blocks.find((item) => item.kind === "tool");
    expect(tool).toMatchObject({ command: "npm test", stdout: "ok\n", status: "done", exitCode: 0 });
  });
});
