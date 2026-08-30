// @vitest-environment jsdom
//
// Renders the two v4 prototype variants against a realistic fleet and pins what they SAY — the
// epicenter sentence of each, the designed empty states, and the one expand interaction. Also the
// round's render fallback: with no browser available, `RENDER_DUMP=1` prints each variant's text.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverviewNextRung } from "./OverviewNextRung";
import { OverviewCheapestPoints } from "./OverviewCheapestPoints";
import type { OverviewLedgerData } from "./OverviewLedgerBaseline";
import type { RepoTrajectory } from "./repoTrajectory";

const repo = (name: string, level: string, overall: number): RepoTrajectory =>
  ({ name, fullName: `acme/${name}`, owner: "acme", level, overall, engine: "claude", points: [], scans: 1 }) as unknown as RepoTrajectory;

const dims = (scores: number[]) => scores.map((score, i) => ({ dimId: `D${i + 1}`, score }));

const fleet: OverviewLedgerData = {
  slug: "acme",
  search: "range=30d",
  periodTitle: "30 days",
  badges: [
    { label: "Org maturity", value: 58, sub: "L3 · Augmented", delta: 4 },
    { label: "AI Adoption", value: 61, delta: 3 },
    { label: "Engineering Rigor", value: 52, delta: 5 },
    { label: "Repos scanned", value: "4/5" },
  ],
  trend: {
    points: [54, 55, 55, 57, 56, 58].map((score, i) => ({ score, at: `2026-08-${String(20 + i).padStart(2, "0")}T00:00:00Z` })),
    label: "30 days",
  },
  postureCounts: { "ai-native": 2, ungoverned: 1, manual: 1, early: 0 },
  dims: [],
  dimDeltas: [{ dimId: "D2", delta: -3 }],
  deltaLabel: "vs 30 days",
  trajectories: [repo("api", "L3", 52), repo("web", "L4", 71), repo("infra", "L2", 40), repo("docs", "L4", 68)],
  heatmapRows: [
    { name: "api", fullName: "acme/api", dims: dims([70, 41, 60, 30, 55, 66, 72, 40, 50]) },
    { name: "web", fullName: "acme/web", dims: dims([80, 52, 75, 66, 70, 70, 80, 70, 74]) },
    { name: "infra", fullName: "acme/infra", dims: dims([40, 30, 45, 20, 40, 50, 60, 30, 45]) },
    { name: "docs", fullName: "acme/docs", dims: dims([66, 60, 70, 65, 90, 68, 70, 66, 60]) },
  ],
};

const empty: OverviewLedgerData = { ...fleet, badges: [], trend: { points: [], label: "30 days" }, trajectories: [], heatmapRows: [], dimDeltas: null };

const dump = (label: string) => {
  if (process.env.RENDER_DUMP) console.log(`\n=== ${label} ===\n${document.body.textContent}`);
};

describe("Next rung", () => {
  it("says the standing, the distance to the rung, and the pace in one read", () => {
    render(<OverviewNextRung {...fleet} />);
    dump("Next rung");
    expect(screen.getByText("58").closest("span")).toBeTruthy();
    expect(screen.getByText("Augmented — 7 points from Integrated.")).toBeTruthy();
    expect(screen.getByText("Up 4 vs 30 days. Two more periods like this one would reach Integrated.")).toBeTruthy();
    expect(screen.getByText("Adoption 61 leads · Rigor 52 trails — rigor is the lever.")).toBeTruthy();
    expect(screen.getByText(/2 of 4 repos are Integrated or above\./)).toBeTruthy();
    expect(screen.getByText(/4\/5 repos scanned/)).toBeTruthy();
    expect(screen.getByText("Integrated · 65")).toBeTruthy();
    expect(screen.getByText("54 · Aug 20")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See every repo →" }).getAttribute("href")).toBe("/org/acme?range=30d&tab=repositories");
  });

  it("designs the zero-data read", () => {
    render(<OverviewNextRung {...empty} />);
    dump("Next rung · empty");
    expect(screen.getByText("No scored repos in this period yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Scan a repository →" })).toBeTruthy();
  });
});

describe("Cheapest points", () => {
  it("leads with the top trade as a verb, shows three, and opens a row to its repos and practice", () => {
    render(<OverviewCheapestPoints {...fleet} />);
    dump("Cheapest points");
    // D2 (weight .15, gaps 24+13+35+5 = 77 → 2.9) outranks D4 (weight .12, gaps 35+45 = 80 → 2.4).
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Adopt test discipline first — +2.9 fleet points across 4 repos below 65.");
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("4 of 4 repos below 65");
    expect(rows[0]!.textContent).toContain("+2.9");
    expect(rows[1]!.textContent).toContain("+2.4");
    expect(document.body.textContent).not.toContain("▼");
    fireEvent.click(rows[0]!);
    expect(screen.getByRole("link", { name: /infra 30/ }).getAttribute("href")).toBe("/report/acme/infra?org=acme");
    expect(screen.getByRole("link", { name: "Open the practice →" }).getAttribute("href")).toMatch(/#practice-test-discipline$/);
    expect(screen.getByText(/These 3 are worth \+7\.1 of the \+11 on the table across 9 practices\. Landing all of it would put the fleet at 69, Integrated/)).toBeTruthy();
  });

  it("designs the zero-repo and all-green reads", () => {
    const { unmount } = render(<OverviewCheapestPoints {...empty} />);
    expect(screen.getByText("No scored repos in this period.")).toBeTruthy();
    unmount();
    render(<OverviewCheapestPoints {...fleet} heatmapRows={[{ name: "web", fullName: "acme/web", dims: dims([80, 70, 75, 66, 70, 70, 80, 70, 74]) }]} />);
    expect(screen.getByText("Every dimension is green in every scored repo.")).toBeTruthy();
  });
});
