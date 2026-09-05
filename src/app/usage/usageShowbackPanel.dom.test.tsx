/** @vitest-environment jsdom */

// MC-B45 — the showback matrix's two states, pinned. The one that matters most is the SECOND: on a
// host where nothing has resolved to a CODEOWNERS team yet, the panel must say attribution is running
// and accruing rather than draw a one-column grid of "Org-wide / $0.00", which reads as a finding.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LaneUsage, TeamUsage } from "@/lib/db/usage-events";
import type { LaneTeamCell } from "@/lib/db/usage-showback";
import { ShowbackMatrixPanel } from "./usageShowbackPanel";

const laneRow = (lane: LaneUsage["lane"]): LaneUsage => ({
  lane, calls: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: null, unpricedCalls: 0,
});
const teamRow = (teamKey: string | null): TeamUsage => ({
  teamKey, label: teamKey ?? "Org-wide (no repo)", calls: 1, estimatedCostUsd: null,
});
const cell = (o: Partial<LaneTeamCell> & { lane: LaneTeamCell["lane"] }): LaneTeamCell => ({
  teamKey: null, calls: 1, estimatedCostUsd: 1, unpricedCalls: 0, ...o,
});

const panel = (cells: LaneTeamCell[], lanes: LaneUsage[], teams: TeamUsage[]) =>
  render(<ShowbackMatrixPanel byLaneTeam={cells} byLane={lanes} byTeam={teams} periodDays={30} />);

describe("the showback matrix", () => {
  const cells = [
    cell({ lane: "scan", teamKey: "platform", calls: 10, estimatedCostUsd: 5 }),
    cell({ lane: "local", teamKey: null, calls: 4, estimatedCostUsd: null, unpricedCalls: 4 }),
  ];
  const draw = () => panel(cells, [laneRow("scan"), laneRow("local")], [teamRow("platform"), teamRow(null)]);

  it("puts a lane on every row and a team on every column", () => {
    draw();
    expect(screen.getByRole("columnheader", { name: /platform/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /scan/i })).toBeInTheDocument();
  });

  it("prints an em dash, never $0.00, for a pair with nothing recorded", () => {
    draw();
    // Two of the four pairs were never recorded (scan × org-wide, local × platform); both are blank.
    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(2);
    for (const d of dashes) expect(d.getAttribute("title")).toMatch(/not a measured zero/i);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("says 'no estimate' for a pair that ran and could not be priced, with the count beside it", () => {
    draw();
    expect(screen.getByText("no estimate")).toBeInTheDocument();
    expect(screen.getByText(/4 unpriced/)).toBeInTheDocument();
  });
});

describe("the showback matrix before any team is attributed", () => {
  it("says attribution is on and accruing instead of drawing a one-column grid", () => {
    panel([cell({ lane: "local", teamKey: null, calls: 3 })], [laneRow("local")], [teamRow(null)]);
    expect(screen.getByText(/Attribution is on, and accruing/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders nothing at all when the ledger is empty — the lane table already said so", () => {
    const { container } = panel([], [], []);
    expect(container.firstChild).toBeNull();
  });
});
