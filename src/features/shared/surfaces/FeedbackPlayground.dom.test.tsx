// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATE_LABEL, VIZ_STATES } from "@/components/org/viz";
import { FeedbackPlayground } from "./FeedbackPlayground";

afterEach(() => vi.useRealTimers());

describe("surface feedback studies", () => {
  it("drives async-ui-states from Defer and VIZ_STATES, not invented loading", () => {
    const { container } = render(<FeedbackPlayground slug="async-ui-states" />);
    for (const s of VIZ_STATES) {
      expect(screen.getByRole("button", { name: STATE_LABEL[s] })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "next-frame" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "idle" }));
    expect(screen.getByRole("button", { name: "idle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "visible" }));
    expect(screen.getByRole("button", { name: "visible" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Ready" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Loading" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Empty" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Error" })).toBeNull();
    expect(container.querySelector("[class*='skeleton']")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/not a loading state/i);
    fireEvent.click(screen.getByRole("button", { name: STATE_LABEL.missing }));
    expect(screen.getByRole("status").textContent).toMatch(/never a zero/i);
    expect(screen.getByRole("status").textContent).not.toMatch(/\b0\b/);
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
