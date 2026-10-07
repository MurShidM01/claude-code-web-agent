// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";
import type { AppState } from "@/lib/app/controller";
import { DEFAULT_SETTINGS } from "@/lib/persistence/settings";

const handers = {
  onNew: vi.fn(),
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
  onMode: vi.fn(),
  onTheme: vi.fn(),
  onSettings: vi.fn(),
  onConnect: vi.fn(),
  onSignIn: vi.fn(),
  onSignOut: vi.fn(),
  onSwitch: vi.fn(),
};

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    conversations: [],
    activeId: null,
    workspace: { id: null, label: null, root: null, kind: "none", capabilities: [] },
    bridge: { status: "unavailable", transport: "none", health: null },
    auth: { status: "signed-out", user: null },
    ...overrides,
  } as unknown as AppState;
}

/** Every block that can hold a user- or filesystem-supplied string. */
const TRUNCATING = [".brand-text", ".side-project .sp-text", ".side-project .sp-title", ".side-project .sp-sub"];

describe("sidebar", () => {
  it("wraps the project name in blocks that can shrink and ellipsize", () => {
    const { container } = render(
      <Sidebar
        {...handers}
        state={state({
          workspace: {
            id: "bridge:/home/dev/a-very-long-monorepo-name-that-would-otherwise-overflow",
            label: "a-very-long-monorepo-name-that-would-otherwise-overflow",
            root: "/home/dev/a-very-long-monorepo-name-that-would-otherwise-overflow",
            kind: "bridge",
            capabilities: [],
          },
        })}
        mode="ask"
      />,
    );

    const project = container.querySelector(".side-project");
    expect(project).toBeTruthy();
    expect(project!.className).not.toContain("idle");
    expect(screen.getByText("a-very-long-monorepo-name-that-would-otherwise-overflow")).toBeTruthy();
    // The long name must sit inside a shrinkable box, otherwise the sidebar
    // grows past its width and pushes the composer off screen.
    for (const selector of TRUNCATING) {
      expect(container.querySelector(selector), `${selector} should exist`).toBeTruthy();
    }
    expect(container.querySelector(".new-chat")!.textContent).toContain("New chat");
  });

  it("keeps the new-chat and project controls above the conversation list", () => {
    const { container } = render(
      <Sidebar
        {...handers}
        state={state({
          conversations: [
            { id: "c1", title: "A conversation with a very long title that should ellipsize", updatedAt: Date.now() },
          ],
        })}
        mode="ask"
      />,
    );

    const order = [...container.querySelectorAll(".side-actions, .side-scroll, .side-footer")].map((node) => node.className);
    expect(order).toEqual(["side-actions", "side-scroll", "side-footer"]);
    const titles = [...container.querySelectorAll(".side-link span")].map((node) => node.textContent);
    expect(titles[0]).toContain("very long title");
  });

  it("shows an empty-state card when there is nothing saved yet", () => {
    render(<Sidebar {...handers} state={state()} mode="ask" />);
    expect(screen.getByText(/conversations live in this browser only/i)).toBeTruthy();
    expect(screen.getByText("No project open")).toBeTruthy();
  });
});
