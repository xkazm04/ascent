// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "./Modal";
import { ConfirmAction } from "@/components/ConfirmAction";

afterEach(() => { cleanup(); document.body.style.overflow = ""; });

it("captures the invoker before a newly opened confirmation autofocuses Cancel", () => {
  function Confirmation() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Ask to delete</button>
      <ConfirmAction open={open} title="Delete item" body="Cannot undo" confirmLabel="Delete"
        onConfirm={vi.fn()} onCancel={() => setOpen(false)} /></>;
  }
  render(<Confirmation />);
  const opener = screen.getByRole("button", { name: "Ask to delete" });
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.activeElement).toBe(opener);
});

it.each([false, true])("routes Escape only to the top nested dialog (locked=%s)", (locked) => {
  const parentClose = vi.fn();
  const childClose = vi.fn();
  function Nested() {
    const [child, setChild] = useState(false);
    return <Modal open onClose={parentClose} ariaLabel="Parent">
      <button onClick={() => setChild(true)}>Open child</button>
      <Modal open={child} locked={locked} onClose={childClose} ariaLabel="Child"><button>Child action</button></Modal>
    </Modal>;
  }
  render(<Nested />);
  fireEvent.click(screen.getByRole("button", { name: "Open child" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(parentClose).not.toHaveBeenCalled();
  expect(childClose).toHaveBeenCalledTimes(locked ? 0 : 1);
});

it("keeps body scrolling locked until the last layer closes, even out of order", () => {
  document.body.style.overflow = "auto";
  const first = render(<Modal open onClose={vi.fn()} ariaLabel="First"><button>First action</button></Modal>);
  const second = render(<Modal open onClose={vi.fn()} ariaLabel="Second"><button>Second action</button></Modal>);
  screen.getByRole("button", { name: "Second action" }).focus();
  first.unmount();
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second action" }));
  second.unmount();
  expect(document.body.style.overflow).toBe("auto");
});

it("restores the parent control and input ownership when a child closes", () => {
  const parentClose = vi.fn();
  function Nested() {
    const [child, setChild] = useState(false);
    return <Modal open onClose={parentClose} ariaLabel="Parent">
      <button onClick={() => setChild(true)}>Open child</button>
      <Modal open={child} onClose={() => setChild(false)} ariaLabel="Child"><button>Child action</button></Modal>
    </Modal>;
  }
  render(<Nested />);
  const opener = screen.getByRole("button", { name: "Open child" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Child" })).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe("hidden");
  expect(parentClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(parentClose).toHaveBeenCalledTimes(1);
});
