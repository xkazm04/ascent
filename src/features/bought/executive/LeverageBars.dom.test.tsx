// @vitest-environment jsdom
//
// The leverage chart at the render layer: the ranking is a SHAPE, and an unprojected gap gets no
// shape at all.
//
// leverageMoves.test.ts pins the arithmetic. These are the assertions a reader would notice: that
// the widest gap's bar is actually the longest one, that a gap the engine could not project draws a
// dashed void with NO numeral beside it (a short bar would be a claim of a small gain), and that the
// chart is reachable without sight through a generated title and a table equivalent.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgRec } from "@/lib/db";
import { LeverageBars } from "./LeverageBars";
import { leverageBars } from "./leverageMoves";

const rec = (over: Partial<OrgRec> = {}): OrgRec => ({
  title: "Add agent guidance",
  dimId: "D1",
  impact: "high",
  rationale: "",
  explore: [],
  repoCount: 3,
  repos: ["a", "b", "c"],
  leverage: 42,
  projectedPoints: 4,
  liftsRepos: 0,
  ...over,
});

const draw = (recs: OrgRec[]) => render(<LeverageBars bars={leverageBars(recs)} />);
const barWidth = (id: string) =>
  Number(document.querySelector(`[data-bar="${id}"] rect`)?.getAttribute("width") ?? "0");

describe("LeverageBars", () => {
  it("gives the widest-reaching gap the longest bar, on one shared scale", () => {
    draw([
      rec({ dimId: "D1", projectedPoints: 5, repoCount: 6 }), // 30 fleet points
      rec({ dimId: "D3", projectedPoints: 5, repoCount: 2 }), // 10
    ]);
    expect(barWidth("D1-0")).toBeGreaterThan(barWidth("D3-1"));
    // The domain leader fills the plot, so the ratio between the two is readable, not just their order.
    expect(barWidth("D3-1") / barWidth("D1-0")).toBeCloseTo(1 / 3, 2);
  });

  it("draws a dashed void — never a bar and never a numeral — where nothing was projected", () => {
    draw([rec({ dimId: "D1" }), rec({ dimId: "D9", projectedPoints: null })]);
    const row = document.querySelector('[data-bar="D9-1"]')!;
    expect(row.getAttribute("data-state")).toBe("missing");
    expect(row.querySelector("rect")).toBeNull();
    expect(row.querySelector("line[stroke-dasharray]")).toBeTruthy();
    // rendersValue(missing) is false; the readout is an em dash, never a number.
    expect(row.querySelector("text:last-of-type")?.textContent).toBe("—");
  });

  it("marks how far into a bar the repos that would cross a maturity level reach", () => {
    draw([rec({ repoCount: 4, liftsRepos: 1, projectedPoints: 4 })]);
    const rung = document.querySelector('[data-rung="D1-0"]');
    expect(rung).toBeTruthy();
    expect(Number(rung!.getAttribute("x1"))).toBeCloseTo(barWidth("D1-0") / 4, 1);
  });

  it("segments a bar per affected repository, so reach is a property of the shape", () => {
    draw([rec({ repoCount: 4, repos: ["a", "b", "c", "d"] })]);
    // 3 dividers for 4 segments, plus nothing else drawn as a plain line in this row.
    expect(document.querySelectorAll('[data-bar="D1-0"] line').length).toBe(3);
  });

  it("is reachable without sight: a generated title and a table equivalent from the same numbers", () => {
    draw([rec({ projectedPoints: 4, repoCount: 3 })]);
    const svg = screen.getByRole("img", { name: /Widest shared gaps across the fleet/i });
    expect(svg.querySelector("title")?.textContent).toMatch(/12 points across 3 repositories/);
    const table = screen.getByRole("table", { name: /Widest shared gaps, ranked by leverage/i });
    expect(table.className).toContain("sr-only");
    expect(table.textContent).toContain("shared by 3 repos: a, b, c");
  });

  it("degrades to a labelled placeholder rather than plotting an empty domain", () => {
    render(<LeverageBars bars={[]} />);
    expect(screen.getByRole("img", { name: /nothing to rank/i })).toBeTruthy();
  });
});
