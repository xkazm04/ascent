// The void-vs-zero split for teams. This is the tab's correctness fix, so it is pinned here rather
// than inferred from the rendered SVG: a team with no commits to take a share OF must never share an
// encoding with a team measured at a genuine 0%.

import { describe, expect, it } from "vitest";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { TEAM_AXES, teamMatrixRows, teamMatrixStates, teamState, unjudgedTeamCount } from "./adoptionTeamMatrix";

type Team = AdoptionOverview["teams"][number];

const team = (over: Partial<Team> = {}): Team => ({
  slug: "@acme/core",
  name: "core",
  aiCommitShare: 40,
  contributors: 5,
  aiContributors: 2,
  repoCount: 3,
  ...over,
});

describe("teamState", () => {
  it("is measured when the producer emitted a real share", () => {
    expect(teamState(team({ aiCommitShare: 40 }))).toBe("measured");
  });

  it("is measured for a genuine 0% — a reading of zero is still a reading", () => {
    expect(teamState(team({ aiCommitShare: 0 }))).toBe("measured");
  });

  it("is not-judged on the producer's NULL, not on a re-derivation from contributors", () => {
    // rollupTeams returns null when there was no commit population to take a share of. This view
    // used to infer that from `contributors === 0`; it reads the producer's own answer now.
    expect(teamState(team({ aiCommitShare: null, contributors: 0 }))).toBe("not-judged");
  });
});

describe("teamMatrixRows", () => {
  it("scores a measured team on both axes", () => {
    const [row] = teamMatrixRows([team({ aiCommitShare: 40, aiContributors: 2, contributors: 5 })]);
    expect(row!.cells).toHaveLength(TEAM_AXES.length);
    expect(row!.cells[0]).toEqual({ state: "measured", score: 40 });
    expect(row!.cells[1]).toEqual({ state: "measured", score: 40 });
  });

  it("keeps a genuine 0% as a MEASURED zero — it is a reading, not an absence", () => {
    const [row] = teamMatrixRows([team({ aiCommitShare: 0, aiContributors: 0, contributors: 12 })]);
    expect(row!.cells[0]).toEqual({ state: "measured", score: 0 });
  });

  it("gives an unattributed team NO score at all, so no numeral can be printed on it", () => {
    const [row] = teamMatrixRows([team({ slug: "@acme/ops", aiCommitShare: null, aiContributors: 0, contributors: 0 })]);
    expect(row!.cells.every((c) => c.state === "not-judged")).toBe(true);
    expect(row!.cells.every((c) => c.score == null)).toBe(true);
  });

  it("does not conflate the two: a measured 0 and an unmeasured team render different states", () => {
    const rows = teamMatrixRows([
      team({ slug: "@acme/measured", aiCommitShare: 0, aiContributors: 0, contributors: 12 }),
      team({ slug: "@acme/unattributed", aiCommitShare: null, aiContributors: 0, contributors: 0 }),
    ]);
    expect(rows[0]!.cells[0]!.state).not.toBe(rows[1]!.cells[0]!.state);
  });

  it("honours the show limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => team({ slug: `@acme/t${i}`, name: `t${i}` }));
    expect(teamMatrixRows(many)).toHaveLength(8);
    expect(teamMatrixRows(many, 3)).toHaveLength(3);
  });
});

describe("teamMatrixStates / unjudgedTeamCount", () => {
  it("lists only the states present, in chart order", () => {
    const measuredOnly = teamMatrixRows([team()]);
    expect(teamMatrixStates(measuredOnly)).toEqual(["measured"]);
    const mixed = teamMatrixRows([team(), team({ slug: "@acme/ops", contributors: 0, aiCommitShare: null })]);
    expect(teamMatrixStates(mixed)).toEqual(["measured", "not-judged"]);
  });

  it("counts the unjudged teams inside the plotted window only", () => {
    const teams = [team(), team({ slug: "@acme/a", contributors: 0, aiCommitShare: null }), team({ slug: "@acme/b", contributors: 0, aiCommitShare: null })];
    expect(unjudgedTeamCount(teams)).toBe(2);
    expect(unjudgedTeamCount(teams, 1)).toBe(0);
  });
});
