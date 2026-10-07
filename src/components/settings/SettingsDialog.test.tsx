// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import type { AppController, AppState } from "@/lib/app/controller";
import { DEFAULT_SETTINGS } from "@/lib/persistence/settings";

function controllerStub() {
  const calls = { tabs: [] as string[], closed: 0 };
  const controller = {
    setSettingsTab: (tab: string) => calls.tabs.push(tab),
    setSettingsOpen: () => { calls.closed += 1; },
    updateSettings: vi.fn(),
    setTheme: vi.fn(),
  } as unknown as AppController;
  return { controller, calls };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    settingsOpen: true,
    settingsTab: "providers",
    settings: { ...DEFAULT_SETTINGS },
    auth: { status: "signed-out", user: null },
    models: { status: "idle", catalog: null, search: "", provider: "all", sort: "name" },
    bridge: { status: "unavailable", transport: "none", health: null },
    logs: [],
    authFlow: null,
    ...overrides,
  } as unknown as AppState;
}

describe("settings dialog", () => {
  it("shows the section title and description in the main pane", () => {
    const { controller } = controllerStub();
    render(<SettingsDialog state={state()} controller={controller} />);
    expect(screen.getByRole("heading", { name: "Providers", level: 2 })).toBeTruthy();
    // Every section is reachable from the nav, including the mobile layout.
    for (const label of ["Appearance", "Models & tools", "Permissions", "Bridge", "Safety", "Shortcuts", "Diagnostics"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("renders each provider card with a status pill and an action", () => {
    const { controller } = controllerStub();
    render(<SettingsDialog state={state()} controller={controller} />);
    for (const title of ["Puter", "OpenAI Code", "Kiro", "Custom provider"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with OpenAI/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign in with Kiro/ })).toBeTruthy();
    // With no custom account saved yet the form starts open, so the primary
    // action is the save button.
    expect(screen.getByRole("button", { name: /Save and fetch models/ })).toBeTruthy();
  });

  it("keeps the custom-provider form collapsed once an account exists", async () => {
    const { controller } = controllerStub();
    render(
      <SettingsDialog
        state={state({
          settings: {
            ...DEFAULT_SETTINGS,
            providers: [{ id: "acct_1", kind: "custom", label: "Groq", enabled: true, createdAt: 1, baseUrl: "https://api.groq.com/openai/v1" }],
          },
        })}
        controller={controller}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Add a provider/ });
    expect(screen.queryByPlaceholderText("https://api.example.com/v1")).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText("https://api.example.com/v1")).toBeTruthy();
  });

  it("switches sections from the navigation", async () => {
    const { controller, calls } = controllerStub();
    render(<SettingsDialog state={state()} controller={controller} />);
    await userEvent.click(screen.getByRole("button", { name: /Permissions/ }));
    expect(calls.tabs).toContain("permissions");
  });

  it("surfaces a sign-in error inside the banner", () => {
    const { controller } = controllerStub();
    render(
      <SettingsDialog
        state={state({
          authFlow: { provider: "kiro", phase: "error", message: "The Kiro device code expired. Start sign-in again." },
        })}
        controller={controller}
      />,
    );
    expect(screen.getByText("Sign-in needs attention")).toBeTruthy();
    expect(screen.getByText(/device code expired/)).toBeTruthy();
  });

  it("groups the model catalog by provider and filters per provider", async () => {
    const { controller } = controllerStub();
    render(
      <SettingsDialog
        state={state({
          settingsTab: "models",
          models: {
            status: "ready",
            search: "",
            provider: "all",
            sort: "name",
            catalog: {
              loadedAt: 0,
              providers: ["kiro", "openai-codex"],
              models: [
                { id: "gpt-5-codex", provider: "openai-codex", name: "GPT-5 Codex", aliases: [], capabilities: [] },
                { id: "kiro-opus", provider: "kiro", name: "Kiro Opus", aliases: [], capabilities: [] },
              ],
            },
          },
        })}
        controller={controller}
      />,
    );

    expect(screen.getByText("GPT-5 Codex")).toBeTruthy();
    expect(screen.getByText("Kiro Opus")).toBeTruthy();

    const filter = screen.getByRole("tab", { name: /^kiro\b/ });
    await userEvent.click(filter);
    expect(screen.getByText("Kiro Opus")).toBeTruthy();
    expect(screen.queryByText("GPT-5 Codex")).toBeNull();
  });
});
