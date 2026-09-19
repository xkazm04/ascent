// @vitest-environment jsdom
//
// THE PANEL MUST NOT LAUNDER A CLAIM INTO A VERDICT (UAT `PRIYA-L1-702`, 2026-08-30).
//
// The live capture: 46 rows reading "closed by the rescan" in this panel while `/api/org/backlog`
// — the ledger that applies the movement witness — reported `done: 0`. The label was unconditional on
// `verdict === "resolved"`, and `resolved` is written both for a row the rescan adjudicated closed
// and for one the agent merely claimed. So the two words are what this file pins, in both
// directions, plus the default for a payload from a server that predates the flag.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CockpitVerdicts, verdictChip } from "./CockpitVerdicts";
import type { LaneOutcomeRow } from "./loopTypes";

const row = (over: Partial<LaneOutcomeRow> = {}): LaneOutcomeRow => ({
  id: "o1",
  runId: "run-1",
  laneId: "lane-1",
  repoFullName: "acme/web",
  recommendationId: "0eff00a8-1111-2222-3333-444444444444",
  cycle: 1,
  verdict: "resolved",
  reason: "",
  verified: false,
  verifiedAt: null,
  files: [],
  deferUntil: null,
  createdAt: "2026-08-30T00:00:00.000Z",
  ...over,
});

describe("verdictChip — the claim and the verdict are two different sentences", () => {
  it("says `closed by the rescan` ONLY for a verified resolve", () => {
    expect(verdictChip({ verdict: "resolved", verified: true }).label).toBe("closed by the rescan");
  });

  it("says `claimed resolved — awaiting the rescan` for an unverified one", () => {
    const chip = verdictChip({ verdict: "resolved", verified: false });
    expect(chip.label).toBe("claimed resolved — awaiting the rescan");
    expect(chip.label).not.toContain("closed by the rescan");
  });

  it("tones the claim differently from the verdict, so the two are not read as siblings", () => {
    expect(verdictChip({ verdict: "resolved", verified: false }).tone).not.toBe(verdictChip({ verdict: "resolved", verified: true }).tone);
    expect(verdictChip({ verdict: "resolved", verified: false }).tone).toContain("italic");
  });

  it("treats a row with NO `verified` field as unverified — a trust flag under-claims", () => {
    expect(verdictChip({ verdict: "resolved" }).label).toBe("claimed resolved — awaiting the rescan");
  });

  it("leaves every other verdict's wording alone", () => {
    expect(verdictChip({ verdict: "skipped" }).label).toBe("skipped");
    expect(verdictChip({ verdict: "needs_human" }).label).toBe("needs a human");
    expect(verdictChip({ verdict: "absent" }).label).toBe("no account given");
    expect(verdictChip({ verdict: "needs_human" }).tone).toContain("warn");
  });
});

describe("CockpitVerdicts", () => {
  it("renders the two resolves as two different statements in one list", () => {
    render(<CockpitVerdicts outcomes={[row({ id: "o1", verified: true }), row({ id: "o2", recommendationId: "d5d90a60-x", verified: false })]} />);
    expect(screen.getAllByText("closed by the rescan")).toHaveLength(1);
    expect(screen.getAllByText("claimed resolved — awaiting the rescan")).toHaveLength(1);
  });

  it("still says so when a run recorded nothing", () => {
    render(<CockpitVerdicts outcomes={[]} />);
    expect(screen.getByText(/recorded no per-item verdicts/i)).toBeTruthy();
  });
});
