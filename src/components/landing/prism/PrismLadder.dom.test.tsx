// @vitest-environment jsdom
//
// The ladder: the plate under the pointer or focus is read out beside it, the click selects, and moving
// away returns to the selection. Under reduced motion the swap beat is 0 ms, which lets the test flush it.

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVELS } from "@/lib/maturity/model";
import { PrismLadder } from "./PrismLadder";

const name = (c: HTMLElement) => c.querySelector(".lvl-stage h3")?.textContent;
const flush = () => act(() => vi.advanceTimersByTimeAsync(300));

describe("PrismLadder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders one plate per level, highest first, and starts on L3", () => {
    const { container } = render(<PrismLadder arch="org" reduced />);
    const plates = [...container.querySelectorAll<HTMLElement>(".plate")];
    expect(plates.map((p) => p.dataset.i)).toEqual(["4", "3", "2", "1", "0"]);
    expect(name(container)).toBe(LEVELS[2]!.name);
    expect(container.querySelector('.plate[aria-selected="true"]')?.getAttribute("data-i")).toBe("2");
  });

  it("previews on hover, returns on leave, and keeps a clicked level", async () => {
    const { container } = render(<PrismLadder arch="org" reduced />);
    const plate = (i: number) => container.querySelector<HTMLElement>(`.plate[data-i="${i}"]`)!;
    fireEvent.mouseEnter(plate(4));
    await flush();
    expect(name(container)).toBe(LEVELS[4]!.name);
    fireEvent.mouseLeave(container.querySelector('[role="listbox"]')!);
    await flush();
    expect(name(container)).toBe(LEVELS[2]!.name);
    fireEvent.click(plate(3));
    fireEvent.mouseLeave(container.querySelector('[role="listbox"]')!);
    await flush();
    expect(name(container)).toBe(LEVELS[3]!.name);
  });

  it("moves with the arrow keys, clamped at the ends", async () => {
    const { container } = render(<PrismLadder arch="org" reduced />);
    const plate = (i: number) => container.querySelector<HTMLElement>(`.plate[data-i="${i}"]`)!;
    plate(4).focus();
    fireEvent.keyDown(plate(4), { key: "ArrowUp" });
    await flush();
    expect(name(container)).toBe(LEVELS[4]!.name);
    fireEvent.keyDown(plate(4), { key: "ArrowDown" });
    await flush();
    expect(document.activeElement).toBe(plate(3));
    expect(name(container)).toBe(LEVELS[3]!.name);
  });

  it("names the next class, and says so at the top of the ladder", async () => {
    const { container } = render(<PrismLadder arch="org" reduced />);
    expect(container.querySelector(".lvl-stage .next")?.textContent).toContain(LEVELS[3]!.name);
    fireEvent.click(container.querySelector('.plate[data-i="4"]')!);
    await flush();
    expect(container.querySelector(".lvl-stage .next")?.textContent).toMatch(/top of the ladder/);
  });

  it("scales each burning line by the dimension's weight under the chosen lens", () => {
    const org = render(<PrismLadder arch="org" reduced />);
    const w = (c: HTMLElement) => (c.querySelector(".plate .strip i") as HTMLElement).style.width;
    const orgW = w(org.container);
    org.unmount();
    const solo = render(<PrismLadder arch="solo" reduced />);
    expect(w(solo.container)).not.toBe(orgW); // D1 is 0.15 (org) vs 0.20 (solo)
  });
});
