// @vitest-environment jsdom
//
// The Teams tab's Wave 3 redesign, pinned at the two places it can silently regress:
//   - every ABSENCE on the tab renders a kit state and no numeral — a team with no commit population
//     (aiCommitShare null), a period with no comparable scans, a dimension never scored;
//   - the two sentences that were demoted are gone from the source, and the affordances that used to
//     need them (sort, expand) carry themselves.
//
// Sibling of TeamsHonesty.dom.test.tsx, which pins the 2026-07 honesty fixes; split rather than
// appended so both stay under the 200-LOC cap for src/features/**.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { TeamsMatrix } from "./TeamsMatrix";
import { TeamsStandings } from "./TeamsStandings";
import { dimMatrixRows, dimMatrixStates, teamSpread, unjudgedCellCount } from "./teamsViz";
import type { TeamRollup } from "@/lib/db";
import type { TeamStandings as TeamStandingsModel } from "@/lib/org/teamStandings";

const PANEL = fs.readFileSync(path.resolve(__dirname, "TeamsRollupPanel.tsx"), "utf8");

const team = (over: Partial<TeamRollup> = {}): TeamRollup =>
  ({
    slug: "@acme/platform",
    name: "platform",
    repoCount: 3,
    totalOwned: 3,
    defaultOwnerCount: 1,
    avgOverall: 70,
    avgAdoption: 60,
    avgRigor: 65,
    aiCommitShare: 50,
    contributors: 12,
    aiContributors: 4,
    champions: [],
    knowledgeScore: 55,
    comparedRepos: 0,
    improving: 0,
    declining: 0,
    avgDelta: 0,
    dimAverages: [{ dimId: "D1", label: "AI Tooling", avg: 80 }],
    repos: [],
    ...over,
  }) as unknown as TeamRollup;

describe("teamsViz — the view models behind the two shapes", () => {
  it("hatches a dimension the team was never scored on, with no score to print", () => {
    const rows = dimMatrixRows([team()], ["D1", "D2"]);
    expect(rows[0]!.cells[0]).toEqual({ state: "measured", score: 80 });
    expect(rows[0]!.cells[1]).toEqual({ state: "not-judged" });
    expect(dimMatrixStates(rows)).toEqual(["measured", "not-judged"]);
    expect(unjudgedCellCount(rows)).toBe(1);
  });

  it("lists only the states present — never a static six-row legend", () => {
    expect(dimMatrixStates(dimMatrixRows([team()], ["D1"]))).toEqual(["measured"]);
  });

  it("refuses a distribution over a single team: a point is not a spread", () => {
    expect(teamSpread([team()])).toBeNull();
    const five = teamSpread([team({ avgOverall: 40 }), team({ slug: "@acme/b", avgOverall: 80 })])!;
    expect([five.min, five.max, five.n]).toEqual([40, 80, 2]);
  });
});

describe("TeamsMatrix — absences carry a state, never a numeral", () => {
  it("hatches a team with no commit population instead of painting scoreHex(0)", () => {
    render(<TeamsMatrix teams={[team({ aiCommitShare: null, contributors: 0, aiContributors: 0 })]} dims={[]} />);
    const cell = document.querySelector('[title*="AI commit share"]')!;
    expect(cell).toBeTruthy();
    expect(cell.textContent).toBe(""); // no "0", no "0/0"
    expect(cell.querySelector("svg")).toBeTruthy();
  });

  it("keeps a measured 0% printed — a reading of zero is still a reading", () => {
    render(<TeamsMatrix teams={[team({ aiCommitShare: 0, aiContributors: 0, contributors: 12 })]} dims={[]} />);
    expect(screen.getByText("0/12")).toBeTruthy();
  });

  it("draws a void for a period with no comparable scans, not an em dash in a column of numbers", () => {
    render(<TeamsMatrix teams={[team({ comparedRepos: 0 })]} dims={[]} />);
    const cell = document.querySelector('[title*="No measurement"]')!;
    expect(cell).toBeTruthy();
    expect(cell.textContent).toBe(""); // the void draws a mark, and the cell prints nothing
    expect(cell.querySelector("svg")).toBeTruthy();
  });

  it("plots the dimensions as a hatched matrix rather than a numeric grid with a '·' void", () => {
    const { container } = render(<TeamsMatrix teams={[team()]} dims={["D1", "D2"]} />);
    const scored = container.querySelector('[data-cell="@acme/platform:AI Tooling"]')!;
    const unscored = container.querySelector('[data-cell="@acme/platform:Testing"]')!;
    expect(scored.getAttribute("data-state")).toBe("measured");
    expect(unscored.getAttribute("data-state")).toBe("not-judged");
    expect(unscored.querySelector("[data-score]")).toBeNull();
    // The old grid printed a bare "·" glyph in the cell; the hatch is a <rect>, and the cell carries
    // no <text> at all — which is `rendersValue` doing the enforcing, not this assertion.
    expect(unscored.querySelector("text")).toBeNull();
    expect(unscored.querySelector("rect[data-mark]")).toBeTruthy();
  });

  it("shows a column is sortable BEFORE it is clicked — the affordance replaced the instruction", () => {
    const { container } = render(<TeamsMatrix teams={[team()]} dims={[]} />);
    expect(container.textContent).toContain("⇅");
  });

  it("says on the row control what expanding it opens", () => {
    render(<TeamsMatrix teams={[team()]} dims={[]} />);
    expect(document.querySelector('[title*="owned repos, AI champions and mover detail"]')).toBeTruthy();
  });
});

describe("TeamsStandings — the spread is drawn, not narrated", () => {
  const standings = {
    teamCount: 2,
    fleetAvgOverall: 60,
    spread: 30,
    maxAbsDelta: 10,
    fleetDimAvgs: [],
    leader: { slug: "@acme/platform", name: "platform", posture: "manual", avgOverall: 80, overallDelta: 20, factors: [], contributors: 10, aiContributors: 4, aiCommitShare: 50, aiShareDelta: 5, champions: [], comparedRepos: 0, avgDelta: 0, improving: 0, declining: 0 },
    laggard: { slug: "@acme/mobile", name: "mobile", posture: "manual", avgOverall: 50, overallDelta: -10, factors: [], contributors: 8, aiContributors: 1, aiCommitShare: null, aiShareDelta: null, champions: [], comparedRepos: 0, avgDelta: 0, improving: 0, declining: 0 },
  } as unknown as TeamStandingsModel;
  const teams = [team({ avgOverall: 80 }), team({ slug: "@acme/mobile", name: "mobile", avgOverall: 50 })];

  it("plots the box instead of stating who leads, who trails and by how much", () => {
    const { container } = render(<TeamsStandings standings={standings} teams={teams} />);
    expect(container.querySelector("[data-box]")).toBeTruthy();
    expect(container.querySelector("[data-median]")).toBeTruthy();
    expect(container.textContent).not.toMatch(/leads at|trails at|point spread/);
  });

  it("hatches the laggard's AI adoption rather than reading it as 0%", () => {
    const { container } = render(<TeamsStandings standings={standings} teams={teams} />);
    expect(container.textContent).toMatch(/AI adoptionNot judged/);
    expect(container.textContent).not.toMatch(/AI adoption\s*0%/);
  });

  it("still renders without the spread — the box is an addition, not a dependency", () => {
    const { container } = render(<TeamsStandings standings={standings} />);
    expect(container.textContent).toContain("@acme/platform");
    expect(container.querySelector("[data-box]")).toBeNull();
  });
});

describe("TeamsRollupPanel — the demoted sentences are gone from the source", () => {
  it("no longer ledes with the essay above the grid", () => {
    expect(PANEL).not.toMatch(/The fleet rolled up by the teams that own it/);
    expect(PANEL).not.toMatch(/Inputs to explore, not a ranking/);
  });

  it("no longer instructs the reader to click a header or a team", () => {
    expect(PANEL).not.toMatch(/Click a header to sort/);
  });

  it("keeps the Δ footnote derived from the one label, and only that claim", () => {
    expect(PANEL).toMatch(/Δ compares \{deltaFootnote\(deltaLabel\)\}/);
    expect(PANEL).not.toMatch(/GitHub Teams \(GraphQL\) attribution is on the roadmap/);
  });
});
