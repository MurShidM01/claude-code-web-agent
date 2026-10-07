// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionDialog } from "@/components/permissions/PermissionDialog";
import { applyTheme } from "@/lib/persistence/settings";

describe("permission dialog", () => {
  it("shows the action, path, command, and both decisions", async () => {
    const onDecide = vi.fn();
    render(
      <PermissionDialog
        request={{
          type: "permission_requested",
          requestId: "p1",
          toolUseId: "t1",
          name: "Bash",
          summary: "Run the test suite",
          why: "The change needs verification.",
          paths: ["sample-project"],
          command: "npm test",
          cwd: "/work/sample-project",
          risk: "shell",
          rememberLabel: "Allow similar shell commands this session",
          signature: "sig",
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("npm test");
    expect(screen.getByRole("dialog")).toHaveTextContent("/work/sample-project");
    expect(screen.getByRole("dialog")).toHaveTextContent("shell");
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecide).toHaveBeenCalledWith(false, false);
  });
});

describe("theme persistence", () => {
  it("stores the choice and toggles the document class", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("kiln.theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("kiln.theme")).toBe("light");
  });
});
