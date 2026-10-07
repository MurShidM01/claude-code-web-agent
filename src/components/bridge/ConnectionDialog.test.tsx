// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionDialog } from "@/components/bridge/ConnectionDialog";
import type { AppController, AppState } from "@/lib/app/controller";

const baseState = {
  connectionOpen: true,
  fsaSupported: true,
  bridge: { status: "connected", transport: "proxy", health: null },
  workspace: { id: null, label: null, root: null, kind: "none", capabilities: [] },
  workspaces: [
    { id: "bridge:/work/api", label: "api", root: "/work/api", kind: "bridge", updatedAt: 3 },
    { id: "fsa:notes", label: "notes", root: "notes", kind: "fsa", updatedAt: 2 },
  ],
} as unknown as AppState;

function setup(overrides: { state?: Partial<AppState> } = {}) {
  const controller = {
    setConnectionOpen: vi.fn(),
    openWorkspace: vi.fn(),
    pickFolder: vi.fn(),
    selectBridgeWorkspace: vi.fn(),
    refreshBridge: vi.fn(),
    pairDirect: vi.fn(),
    closeWorkspace: vi.fn(),
    requestConfirm: vi.fn(async () => true),
  } as unknown as AppController & Record<string, ReturnType<typeof vi.fn>>;
  render(<ConnectionDialog state={{ ...baseState, ...overrides.state } as AppState} controller={controller} />);
  return controller;
}

describe("open a project dialog", () => {
  it("lists recent projects and reopens one with a single click", async () => {
    const controller = setup();
    expect(screen.getByRole("dialog")).toHaveTextContent("Recent projects");
    await userEvent.click(screen.getByRole("button", { name: /api/i }));
    await waitFor(() => expect(controller.openWorkspace).toHaveBeenCalledWith("bridge:/work/api"));
  });

  it("disables a bridge path when the bridge is offline and says why", () => {
    setup({ state: { bridge: { status: "unavailable", transport: "none", health: null } } as Partial<AppState> });
    expect(screen.getByRole("button", { name: /api/i })).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveTextContent(/bridge offline/i);
    expect(screen.getByRole("button", { name: /notes/i })).toBeEnabled();
  });

  it("keeps Open path disabled while the bridge is offline", () => {
    setup({ state: { bridge: { status: "unavailable", transport: "none", health: null } } as Partial<AppState> });
    expect(screen.getByRole("button", { name: /Open path/i })).toBeDisabled();
  });

  it("opens the typed path through the bridge", async () => {
    const controller = setup();
    await userEvent.type(screen.getByPlaceholderText("/path/to/project"), "/work/api");
    await userEvent.click(screen.getByRole("button", { name: /Open path/i }));
    await waitFor(() => expect(controller.selectBridgeWorkspace).toHaveBeenCalledWith("/work/api"));
  });

  it("can close the project that is already open", async () => {
    const controller = setup({
      state: { workspace: { id: "bridge:/work/api", label: "api", root: "/work/api", kind: "bridge", capabilities: [] } } as Partial<AppState>,
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Current project");
    await userEvent.click(screen.getByRole("button", { name: /Close project/i }));
    await waitFor(() => expect(controller.closeWorkspace).toHaveBeenCalled());
  });

  it("falls back to the folder picker when this browser has no File System Access API", () => {
    setup({ state: { fsaSupported: false } as Partial<AppState> });
    expect(screen.getByRole("button", { name: /Chromium/i })).toBeDisabled();
  });
});
