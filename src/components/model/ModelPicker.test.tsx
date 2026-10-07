// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/model/ModelPicker";
import type { AppState } from "@/lib/app/controller";

function stateWith(models: AppState["models"]["catalog"]): AppState {
  return {
    models: { status: "ready", catalog: models, search: "", provider: "all", sort: "name" },
    auth: { status: "signed-out", user: null },
  } as unknown as AppState;
}

const catalog = {
  loadedAt: 0,
  providers: ["kiro", "openai-codex", "Puter"],
  models: [
    { id: "claude-sonnet-4-5", provider: "Puter", name: "Claude Sonnet 4.5", aliases: [], capabilities: ["tools", "vision"] },
    { id: "gpt-5-codex", provider: "openai-codex", name: "GPT-5 Codex", aliases: [], capabilities: ["tools", "reasoning"] },
    { id: "CLAUDE_SONNET_4_5_20250929_V1_0", provider: "kiro", name: "Claude Sonnet 4.5", aliases: [], capabilities: ["tools"] },
  ],
};

describe("model picker", () => {
  it("shows every provider as a filter chip and groups the list", async () => {
    render(
      <ModelPicker
        state={stateWith(catalog)}
        selectedId="gpt-5-codex"
        onQuery={vi.fn()}
        onProvider={vi.fn()}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /GPT-5 Codex/i }));
    const list = screen.getByRole("listbox");

    for (const provider of ["kiro", "openai-codex", "Puter"]) {
      expect(within(list).getByRole("button", { name: provider })).toBeTruthy();
    }
    // Each provider gets a labelled group, so a long id cannot be mistaken
    // for a different account's model.
    const groupHeadings = [...list.querySelectorAll(".model-popover-group-head strong")].map((node) => node.textContent);
    expect([...groupHeadings].sort()).toEqual(["Puter", "kiro", "openai-codex"]);
    expect(within(list).getByText("GPT-5 Codex")).toBeTruthy();
    expect(within(list).getByText("CLAUDE_SONNET_4_5_20250929_V1_0")).toBeTruthy();
  });

  it("reports the chosen provider with the model id", async () => {
    const onSelect = vi.fn();
    render(
      <ModelPicker
        state={stateWith(catalog)}
        selectedId={null}
        onQuery={vi.fn()}
        onProvider={vi.fn()}
        onSort={vi.fn()}
        onSelect={onSelect}
        onRefresh={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Choose model/i }));
    await userEvent.click(screen.getByRole("option", { name: /CLAUDE_SONNET_4_5_20250929_V1_0/ }));
    expect(onSelect).toHaveBeenCalledWith("CLAUDE_SONNET_4_5_20250929_V1_0", "kiro");
  });

  it("explains an empty catalog instead of showing a blank panel", async () => {
    render(
      <ModelPicker
        state={stateWith({ loadedAt: 0, providers: [], models: [] })}
        selectedId={null}
        onQuery={vi.fn()}
        onProvider={vi.fn()}
        onSort={vi.fn()}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /No models yet/i }));
    expect(screen.getByText(/live catalog is empty/i)).toBeTruthy();
  });
});
