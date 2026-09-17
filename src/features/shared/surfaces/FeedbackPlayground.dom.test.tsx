// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackPlayground } from "./FeedbackPlayground";

afterEach(() => vi.useRealTimers());

describe("surface feedback studies", () => {
  it("allows a failed state to recover in the same workspace", () => {
    render(<FeedbackPlayground slug="async-ui-states" />);
    fireEvent.click(screen.getByRole("button", { name: "Error" }));
    expect(screen.getByRole("status").textContent).toContain("couldn’t load");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("status").textContent).toContain("workspace is ready");
  });

  it("finishes the simulated save before offering undo", () => {
    vi.useFakeTimers();
    render(<FeedbackPlayground slug="toasts-notifications" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("status").textContent).toContain("Changes undone");
  });

  it("routes design-tokens to the live table, not a Mint/Amber re-theme", () => {
    render(<FeedbackPlayground slug="design-tokens" />);
    expect(screen.queryByRole("button", { name: "Mint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Amber" })).toBeNull();
    expect(screen.getByText("accent")).toBeTruthy();
    expect(screen.getByText("LEVEL_HEX")).toBeTruthy();
  });
});
