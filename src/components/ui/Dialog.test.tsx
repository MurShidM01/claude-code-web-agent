// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/ui/Dialog";

function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  // Inline handler, exactly like the real dialogs: a new identity per render.
  return (
    <Dialog open title="Sample" onClose={() => onClose()}>
      <p>Fields here re-render the parent on every keystroke.</p>
      {/* A control before the field, like a recent-project row: the old focus
          logic jumped back to it after every character. */}
      <button type="button" className="ws-row">
        recent project
      </button>
      <label className="field">
        <span>Path</span>
        <input value={value} placeholder="path" onChange={(event) => setValue(event.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn primary">
          Go
        </button>
      </div>
    </Dialog>
  );
}

describe("dialog focus", () => {
  it("keeps focus in the field while typing a whole value", async () => {
    render(<Harness onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("path") as HTMLInputElement;
    await userEvent.type(input, "/work/api");
    expect(input.value).toBe("/work/api");
    expect(document.activeElement).toBe(input);
  });

  it("focuses the dialog itself when nothing asks for autofocus, so Enter cannot activate a control by accident", () => {
    render(<Harness onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("closes on Escape through the latest handler", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
