// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Defer } from "./Defer";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("./useReducedMotion", () => ({ useReducedMotion: () => preference.reduced }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); preference.reduced = false; });

describe("Defer preserves content after its first arrival", () => {
  it.each(["immediate", "reduced-motion"])("keeps entered state after %s is disabled", (policy) => {
    vi.stubGlobal("requestIdleCallback", vi.fn(() => 1));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    preference.reduced = policy === "reduced-motion";
    const { rerender } = render(<Defer strategy="idle" immediate={policy === "immediate"}>
      <input aria-label="Draft" defaultValue="" />
    </Defer>);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Unfinished draft" } });
    preference.reduced = false;
    rerender(<Defer strategy="idle" immediate={false}><input aria-label="Draft" defaultValue="" /></Defer>);
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input.value).toBe("Unfinished draft");
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
  });

  it("still defers a new instance after the immediate instance unmounts", () => {
    vi.stubGlobal("requestIdleCallback", vi.fn(() => 1));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const first = render(<Defer immediate><input aria-label="First" /></Defer>);
    first.unmount();
    render(<Defer strategy="idle" placeholder={<span>Waiting</span>}><input aria-label="Second" /></Defer>);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
  });
});
