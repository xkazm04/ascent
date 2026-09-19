// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";
import { ConfirmAction } from "@/components/ConfirmAction";

afterEach(cleanup);

describe("Modal focus lifecycle", () => {
  it("focuses a portal mounted already open and restores the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Modal open onClose={vi.fn()} ariaLabel="Details"><p>Details</p></Modal>);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it.each([false, true])("cycles from the panel into its controls (shift=%s)", (shiftKey) => {
    render(<Modal open onClose={vi.fn()} ariaLabel="Details"><button>First</button><button>Last</button></Modal>);
    const panel = screen.getByRole("button", { name: "First" }).parentElement!;
    panel.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
    fireEvent(panel, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: shiftKey ? "Last" : "First" }));
  });

  it("keeps Tab on the panel when every control is disabled", () => {
    render(<Modal open locked onClose={vi.fn()} ariaLabel="Saving"><button disabled>Saving</button></Modal>);
    const panel = screen.getByRole("button").parentElement!;
    panel.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(panel, event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel);
  });

  it("preserves the confirmation's Cancel autofocus", () => {
    render(<ConfirmAction open title="Delete item" body="Cannot undo" confirmLabel="Delete"
      onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("wraps endpoints and respects updated locked state for Escape", () => {
    const close = vi.fn();
    const content = <><button>First</button><button>Last</button></>;
    const { rerender } = render(<Modal open onClose={close} ariaLabel="Details">{content}</Modal>);
    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    rerender(<Modal open locked onClose={close} ariaLabel="Details">{content}</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    rerender(<Modal open onClose={close} ariaLabel="Details">{content}</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
