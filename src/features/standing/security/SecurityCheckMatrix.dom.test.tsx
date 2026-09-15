// @vitest-environment jsdom
//
// The load-bearing assertion of this tab: a control that did not produce a grade must be HATCHED and
// must carry no numeral. Not "should" — the geometry is driven by the shared `VizState`, so the only
// way to print a number on such a cell is to change its state, which changes its paint too. These
// tests fail if either half is ever loosened.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { SecurityRowCheck } from "@/lib/org/security";
import { HATCH_ID } from "@/components/org/viz";
import { SecurityCheckMatrix } from "./SecurityCheckMatrix";

function check(over: Partial<SecurityRowCheck> = {}): SecurityRowCheck {
  return { id: "branch-protection", name: "Branch protection", group: "posture", risk: "high", score: 8, detail: "", ...over };
}

const graded = { fullName: "acme/web", name: "web", measured: true, checks: [check()] };
const ungraded = { fullName: "acme/api", name: "api", measured: true, checks: [check({ score: null })] };
const unscanned = { fullName: "acme/old", name: "old", measured: false, checks: [] as SecurityRowCheck[] };

describe("SecurityCheckMatrix — absence cannot look like a pass", () => {
  it("a graded control prints its grade", () => {
    const { container } = render(<SecurityCheckMatrix rows={[graded]} />);
    const cell = container.querySelector('[data-cell="acme/web:Branch"]')!;
    expect(cell.getAttribute("data-state")).toBe("measured");
    expect(cell.querySelector("[data-score]")!.textContent).toBe("80");
  });

  it("an UNGRADED control hatches and prints nothing", () => {
    const { container } = render(<SecurityCheckMatrix rows={[ungraded]} />);
    const cell = container.querySelector('[data-cell="acme/api:Branch"]')!;
    expect(cell.getAttribute("data-state")).toBe("not-judged");
    expect(cell.querySelector("[data-score]")).toBeNull();
    expect(cell.querySelector("[data-mark]")!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
  });

  it("a repo whose scan carried no D9 row is a VOID row — no mark, no numeral", () => {
    const { container } = render(<SecurityCheckMatrix rows={[unscanned]} />);
    const cell = container.querySelector('[data-cell="acme/old:Branch"]')!;
    expect(cell.getAttribute("data-state")).toBe("missing");
    expect(cell.querySelector("[data-mark]")).toBeNull();
    expect(cell.querySelector("[data-score]")).toBeNull();
  });

  it("the accessible name states both absences, so a screen reader is not told a pass either", () => {
    const { container } = render(<SecurityCheckMatrix rows={[graded, ungraded, unscanned]} />);
    const label = container.querySelector("svg[role='img']")!.getAttribute("aria-label")!;
    expect(label).toMatch(/not judged/i);
    expect(label).toMatch(/no measurement/i);
    expect(label).toMatch(/hatched cell was not judged/i);
  });

  it("the legend lists only the states actually drawn", () => {
    const { container } = render(<SecurityCheckMatrix rows={[graded]} />);
    const labels = [...container.querySelectorAll("ul li")].map((li) => li.textContent);
    expect(labels.some((l) => /Measured/i.test(l ?? ""))).toBe(true);
    expect(labels.some((l) => /Not judged/i.test(l ?? ""))).toBe(false);
  });
});
