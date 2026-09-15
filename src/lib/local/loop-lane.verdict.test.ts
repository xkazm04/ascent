// THE RESCAN'S VERDICT IS NOT THE AGENT'S CLAIM (UAT `PRIYA-L1-702`, 2026-08-30).
//
// `rescanWorktree` used to return `report.resolvedFollowUpIds` as `closedIds` — the ids named by
// `Ascent-Resolves:` trailers in the branch's commit messages. On the agent lane the LANE wrote those
// trailers, from the session's own `RESOLVED:` lines, so the "verifier" was reading the claimant's
// own statement back: 46 rows rendered "closed by the rescan" while the ledger that applies the
// movement witness reported `done: 0`.
//
// `persistScanReport` already runs the trailer set through `decideInProgress` — restatement, the
// dimension's own movement, and `attributeDelta` over the two engines — and now returns what it
// actually closed. This file pins that `closedIds` comes from THAT and the trailer set comes back
// separately, so no path can print a claim as a verdict again.

import { beforeEach, describe, expect, it, vi } from "vitest";

const persisted = {
  value: { scanId: "scan-after", closedFollowUpIds: ["gap-1"] } as { scanId: string; closedFollowUpIds: string[] } | null,
};
const scanned = { resolvedFollowUpIds: ["gap-1", "gap-2", "gap-3"] as string[] | undefined };

vi.mock("@/lib/db", () => ({
  persistScanReport: vi.fn(async () => persisted.value),
  getLatestPlatformSignals: vi.fn(async () => null),
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({ resolvedFollowUpIds: scanned.resolvedFollowUpIds })) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

import { rescanWorktree } from "@/lib/local/loop-lane";

const rescan = () => rescanWorktree({ org: "kiro", repo: "o/r", dir: "/tmp/wt", branch: "ascent/loop-1", onStage: () => {} });

beforeEach(() => {
  persisted.value = { scanId: "scan-after", closedFollowUpIds: ["gap-1"] };
  scanned.resolvedFollowUpIds = ["gap-1", "gap-2", "gap-3"];
});

describe("rescanWorktree — the adjudicated set, never the trailer set", () => {
  it("returns only what `persistScanReport` ADJUDICATED as closed", async () => {
    const out = await rescan();
    expect(out.closedIds).toEqual(["gap-1"]);
  });

  it("returns the trailers as CLAIMS, on their own field", async () => {
    const out = await rescan();
    expect(out.claimedIds).toEqual(["gap-1", "gap-2", "gap-3"]);
    // The two refused claims are nowhere near the verdict.
    expect(out.closedIds).not.toContain("gap-2");
    expect(out.closedIds).not.toContain("gap-3");
  });

  it("closes NOTHING when the movement witness refused every claim", async () => {
    persisted.value = { scanId: "scan-after", closedFollowUpIds: [] };
    const out = await rescan();
    expect(out.closedIds).toEqual([]);
    expect(out.claimedIds).toHaveLength(3);
    expect(out.scanId).toBe("scan-after");
  });

  it("closes nothing when persistence is off — an unpersisted scan adjudicated nothing", async () => {
    persisted.value = null;
    const out = await rescan();
    expect(out).toMatchObject({ scanId: null, closedIds: [] });
  });

  it("can close an id no trailer named — the rescan's own not-restated-and-moved rule", async () => {
    scanned.resolvedFollowUpIds = [];
    persisted.value = { scanId: "scan-after", closedFollowUpIds: ["gap-9"] };
    const out = await rescan();
    expect(out.closedIds).toEqual(["gap-9"]);
    expect(out.claimedIds).toEqual([]);
  });
});
