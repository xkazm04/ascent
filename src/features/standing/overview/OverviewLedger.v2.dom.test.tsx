// @vitest-environment jsdom
//
// Pins the v2 (Prism) Overview's honesty rules, the ones a recomposition could quietly drop:
//  - a fleet with no live score is STATED ("has no live score yet"), never a 0 or an "L? · —" grade,
//  - a dimension no repo scored is an empty track that says "not judged", never a bar,
//  - an absent matrix cell is the void mark, never a score of 0 and never a click target,
//  - the "Fix first" slot renders exactly where the layout puts it (under the masthead),
//  - the green floor is drawn on every judged line.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { OverviewLedgerV2 } from "./OverviewLedger.v2";
import type { OverviewLedgerData } from "./OverviewLedger";
import type { ScoreBadge } from "./OrgScoreBadges";

const scored: ScoreBadge[] = [
  { label: "Org maturity", value: 71, sub: "L4 · Integrated", title: "Average over the 2 live-scored repos", delta: 3, deltaLabel: "vs 90 days ago" },
  { label: "AI Adoption", value: 66 },
  { label: "Engineering Rigor", value: 75 },
  { label: "Repos scanned", value: "2/2" },
];
const unscored: ScoreBadge[] = [
  { label: "Org maturity", value: "—", title: "No live-scored repositories in this set" },
  { label: "AI Adoption", value: "—" },
  { label: "Engineering Rigor", value: "—" },
  { label: "Repos scanned", value: "0/2" },
];

const base = (over: Partial<OverviewLedgerData> = {}): OverviewLedgerData => ({
  slug: "acme",
  search: "",
  periodTitle: "Last 90 days",
  badges: scored,
  trend: { points: [], label: "Last 90 days" },
  forecast: null,
  postureCounts: { "ai-native": 1, early: 1 },
  dims: [
    { dimId: "D1", avg: 80 },
    { dimId: "D2", avg: 40 },
  ],
  dimDeltas: null,
  deltaLabel: "vs last 90 days",
  trajectories: [],
  heatmapRows: [
    { name: "api", fullName: "acme/api", dims: [{ dimId: "D1", score: 80 }, { dimId: "D2", score: 40 }] },
    { name: "legacy", fullName: "acme/legacy", dims: [{ dimId: "D1", score: 70 }] },
  ],
  ...over,
});

describe("OverviewLedgerV2", () => {
  it("leads with the standing as one statement in display type, level and score named", () => {
    render(<OverviewLedgerV2 {...base()} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("acme stands at");
    expect(h1.querySelector("b")?.textContent).toBe("L4 · 71");
    expect(screen.getAllByText(/vs 90 days ago/).length).toBeGreaterThan(0);
  });

  it("states a fleet with no live score in words, never as a grade", () => {
    render(<OverviewLedgerV2 {...base({ badges: unscored, dims: [], heatmapRows: [] })} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("acme has no live score yet");
    expect(h1.textContent).not.toMatch(/\b0\b/);
  });

  it("slots the Fix first band directly after the masthead", () => {
    const { container } = render(<OverviewLedgerV2 {...base()} fixFirst={<div data-testid="fix">fix first</div>} />);
    const masthead = container.querySelector('[data-kit="masthead"]')!;
    expect(masthead.nextElementSibling?.getAttribute("data-testid")).toBe("fix");
  });

  it("draws the green floor on a judged line and reads a dimension with no scored repo as not judged", () => {
    const { container } = render(<OverviewLedgerV2 {...base({ heatmapRows: [{ name: "api", fullName: "acme/api", dims: [{ dimId: "D2", score: 40 }] }] })} />);
    const lines = container.querySelectorAll('[data-kit="dimension-line"]');
    expect(lines.length).toBe(2);
    const d1 = container.querySelector('[data-dimension="1"]')!;
    expect(within(d1 as HTMLElement).getByText("not judged")).toBeTruthy();
    expect(d1.querySelector<HTMLElement>('[data-role="dimension-bar"]')?.style.width).toBe("0%");
    const d2 = container.querySelector('[data-dimension="2"]')!;
    expect(d2.querySelector('[data-role="dimension-floor"]')).toBeTruthy();
    expect(d2.querySelector<HTMLElement>('[data-role="dimension-bar"]')?.style.width).toBe("40%");
  });

  it("draws an absent matrix cell as a void, not a 0, and offers no detail for it", () => {
    render(<OverviewLedgerV2 {...base()} />);
    expect(screen.queryByLabelText(/legacy D2 score/)).toBeNull();
    expect(screen.getByLabelText("legacy D2: no measurement")).toBeTruthy();
    expect(screen.getByLabelText("api D2 score 40, open detail")).toBeTruthy();
  });

  it("turns only the number warn below the green floor and keeps the hue on the dimension", () => {
    render(<OverviewLedgerV2 {...base()} />);
    const low = screen.getByLabelText("api D2 score 40, open detail");
    expect(low.querySelector("span")?.className).toContain("text-warn");
    const hueBar = low.querySelector<HTMLElement>("span > span");
    expect(hueBar?.style.background).toContain("--spec-2");
  });
});
