// MC-B45 — the lane × team showback matrix, the fold half.
//
// Spec #11 promised the matrix and MC-B19 sequenced it behind real data. The rules it inherits are
// not new here, and every one of them is a rule some panel on `/usage` already learned the hard way:
// a null cost is not $0 (VICTOR-L1-05), an unrecognized lane is disclosed rather than dropped
// (MC-B31), a team-less row is the explicit org-wide bucket rather than a gap, and a pair with NO
// record is blank rather than a measured zero.

import { describe, expect, it } from "vitest";
import { UNKNOWN_LANE, type LaneUsage, type TeamUsage } from "./usage-events";
import { buildShowbackMatrix, mergeLaneTeamCells, type LaneTeamCell } from "./usage-showback";

const cell = (o: Partial<LaneTeamCell> & { lane: LaneTeamCell["lane"] }): LaneTeamCell => ({
  teamKey: null, calls: 1, estimatedCostUsd: 1, unpricedCalls: 0, ...o,
});

const laneRow = (lane: LaneUsage["lane"]): LaneUsage => ({
  lane, calls: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: null, unpricedCalls: 0,
});

const teamRow = (teamKey: string | null): TeamUsage => ({
  teamKey, label: teamKey ?? "Org-wide (no repo)", calls: 1, estimatedCostUsd: null,
});

describe("mergeLaneTeamCells", () => {
  it("folds two cells on the same (lane, team) key", () => {
    const out = mergeLaneTeamCells([
      cell({ lane: "local", teamKey: "platform", calls: 2, estimatedCostUsd: 1.5 }),
      cell({ lane: "local", teamKey: "platform", calls: 3, estimatedCostUsd: 2.5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.calls).toBe(5);
    expect(out[0]!.estimatedCostUsd).toBe(4);
  });

  it("keeps a team-less cell distinct from a team's — org-wide is a bucket, not a missing value", () => {
    const out = mergeLaneTeamCells([
      cell({ lane: "local", teamKey: null }),
      cell({ lane: "local", teamKey: "platform" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("refuses to price a merge where one side had calls and no estimate", () => {
    // Adding only the priced half would print a confident figure that omits real spend — the same
    // half-billing trap estimateLlmCostUsd and mergeTeamUsage both refuse.
    const out = mergeLaneTeamCells([
      cell({ lane: "athena", teamKey: "web", calls: 4, estimatedCostUsd: null, unpricedCalls: 4 }),
      cell({ lane: "athena", teamKey: "web", calls: 1, estimatedCostUsd: 3 }),
    ]);
    expect(out[0]!.estimatedCostUsd).toBeNull();
    expect(out[0]!.calls).toBe(5);
    expect(out[0]!.unpricedCalls).toBe(4);
  });
});

describe("buildShowbackMatrix", () => {
  const byLane = [laneRow("scan"), laneRow("local"), laneRow("athena")];
  const byTeam = [teamRow("platform"), teamRow(null), teamRow("web")];
  const cells = [
    cell({ lane: "scan", teamKey: "platform", calls: 10, estimatedCostUsd: 5 }),
    cell({ lane: "local", teamKey: "platform", calls: 2, estimatedCostUsd: 1 }),
    cell({ lane: "local", teamKey: null, calls: 1, estimatedCostUsd: null, unpricedCalls: 1 }),
  ];
  const m = buildShowbackMatrix(cells, byLane, byTeam);

  it("takes its row and column order from the panels already on the page", () => {
    // Re-deriving the order here would let the matrix disagree with the tables above it about which
    // lanes and teams exist at all.
    expect(m.rows.map((r) => r.lane)).toEqual(["scan", "local"]);
    expect(m.teams.map((t) => t.label)).toEqual(["platform", "Org-wide (no repo)"]);
  });

  it("drops a lane that recorded nothing rather than printing a row of zeros", () => {
    expect(m.rows.some((r) => r.lane === "athena")).toBe(false);
  });

  it("drops a team column nothing was recorded against", () => {
    expect(m.teams.some((t) => t.key === "web")).toBe(false);
  });

  it("sorts the org-wide bucket last — it is the residue, not a team", () => {
    expect(m.teams[m.teams.length - 1]!.key).toBeNull();
  });

  it("leaves a pair with NO record null, never a zero cell", () => {
    const scan = m.rows.find((r) => r.lane === "scan")!;
    // scan × platform was recorded; scan × org-wide was not.
    expect(scan.cells[0]!.estimatedCostUsd).toBe(5);
    expect(scan.cells[1]).toBeNull();
  });

  it("carries an unpriced count through so a cell with no estimate reads as a floor", () => {
    const local = m.rows.find((r) => r.lane === "local")!;
    const orgWide = local.cells[1]!;
    expect(orgWide.estimatedCostUsd).toBeNull();
    expect(orgWide.unpricedCalls).toBe(1);
  });

  it("keeps an unrecognized lane's cells rather than dropping them (MC-B31's rule)", () => {
    const withUnknown = buildShowbackMatrix(
      [...cells, cell({ lane: UNKNOWN_LANE, teamKey: "platform", calls: 7 })],
      [...byLane, laneRow(UNKNOWN_LANE)],
      byTeam,
    );
    expect(withUnknown.rows.find((r) => r.lane === UNKNOWN_LANE)!.calls).toBe(7);
  });

  it("reports `unattributed` when the only column is the org-wide bucket", () => {
    // A one-column table of "Org-wide" is not a matrix; the panel says attribution is accruing.
    const none = buildShowbackMatrix(
      [cell({ lane: "local", teamKey: null, calls: 3 })],
      [laneRow("local")],
      [teamRow(null)],
    );
    expect(none.unattributed).toBe(true);
  });

  it("reports `unattributed` for an empty window too — accruing, not 'nothing happened'", () => {
    expect(buildShowbackMatrix([], [], []).unattributed).toBe(true);
  });

  it("is NOT unattributed as soon as one real team appears", () => {
    expect(m.unattributed).toBe(false);
  });
});
