// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopyForLlm } from "./CopyForLlm";

afterEach(() => {
  cleanup();
  document.querySelectorAll("textarea").forEach((node) => node.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function clipboard(writeText?: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

it("removes the temporary textarea when the legacy clipboard command throws", async () => {
  clipboard();
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => { throw new Error("Blocked"); }) });
  render(<CopyForLlm text="Brief" />);
  await act(async () => { fireEvent.click(screen.getByRole("button")); });
  const manual = screen.getByLabelText("Markdown briefing to copy manually");
  expect([...document.querySelectorAll("textarea")]).toEqual([manual]);
  expect(document.activeElement).toBe(manual);
});

it("returns focus to the invoking button after a successful legacy copy", async () => {
  clipboard();
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });
  render(<CopyForLlm text="Brief" />);
  const button = screen.getByRole("button");
  button.focus();
  await act(async () => { fireEvent.click(button); });
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard.");
});

it("clears its feedback timer when unmounted", async () => {
  vi.useFakeTimers();
  clipboard(async () => {});
  const { unmount } = render(<CopyForLlm text="Brief" />);
  await act(async () => { fireEvent.click(screen.getByRole("button")); });
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not schedule feedback or call a stale owner after late clipboard completion", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  clipboard(() => new Promise<void>((resolve) => { finish = resolve; }));
  const onCopied = vi.fn();
  const { unmount } = render(<CopyForLlm text="Brief" onCopied={onCopied} />);
  fireEvent.click(screen.getByRole("button"));
  unmount();
  await act(async () => { finish(); });
  expect(onCopied).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
