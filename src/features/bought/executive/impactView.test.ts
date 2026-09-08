// The Impact Ledger's refusals, pinned at the geometry layer — the sentences the field-notes
// paragraph used to carry, now testable as shapes.
//
// org-impact.test.ts pins the model (null-not-zero, verified-only, sign-aware). This file pins that
// the DRAWING inherits those rules: nothing re-scanned ⇒ no movement rows at all (the chart then
// draws a void), and a regression keeps its sign on the same shared scale as the gains rather than
// being absorbed into a positive headline.

import { describe, expect, it } from "vitest";
import { buildImpactLedger, type ImpactPrInput } from "@/lib/db/org-impact";
import { hasMovement, impactFunnelStages, impactMovementRows, movementDomain } from "./impactView";

const pr = (over: Partial<ImpactPrInput> = {}): ImpactPrInput => ({
  repoFullName: "acme/web",
  dimId: "D1",
  practiceId: "agent-guidance",
  prNumber: 1,
  prUrl: "https://github.com/acme/web/pull/1",
  mergedAt: new Date("2026-08-01T00:00:00Z"),
  impactDim: 6,
  impactOverall: 2,
  verifiedScanId: "scan_1",
  ...over,
});

describe("impactFunnelStages", () => {
  it("is three counts, so a zero here is a real measurement and not an absence", () => {
    const stages = impactFunnelStages(buildImpactLedger([pr(), pr({ prNumber: 2, verifiedScanId: null, impactDim: null })]));
    expect(stages.map((s) => [s.id, s.value])).toEqual([
      ["merged", 2],
      ["verified", 1],
      ["moved", 1],
    ]);
    expect(stages.every((s) => s.state === "measured")).toBe(true);
  });
});

describe("impactMovementRows", () => {
  it("has NO rows when nothing has been re-scanned — the chart draws a void, never a zero bar", () => {
    const ledger = buildImpactLedger([pr({ verifiedScanId: null, impactDim: null, impactOverall: null })]);
    expect(ledger.dimPoints).toBeNull();
    expect(hasMovement(ledger)).toBe(false);
    expect(impactMovementRows(ledger)).toEqual([]);
  });

  it("keeps a regression's sign, on the same scale as the gains", () => {
    const rows = impactMovementRows(
      buildImpactLedger([pr({ dimId: "D1", impactDim: 8 }), pr({ dimId: "D3", prNumber: 2, impactDim: -3 })]),
    );
    expect(rows.map((r) => [r.dimId, r.points])).toEqual([
      ["D1", 8],
      ["D3", -3],
    ]);
    // One symmetric domain: a -8 and a +8 must be the same length in opposite directions.
    expect(movementDomain(rows)).toBe(8);
  });

  it("orders by absolute movement, so the row that dominated the period reads first", () => {
    const rows = impactMovementRows(
      buildImpactLedger([
        pr({ dimId: "D1", impactDim: 2 }),
        pr({ dimId: "D3", prNumber: 2, impactDim: -9 }),
        pr({ dimId: "D7", prNumber: 3, impactDim: 5 }),
      ]),
    );
    expect(rows.map((r) => r.dimId)).toEqual(["D3", "D7", "D1"]);
    expect(movementDomain(rows)).toBe(9);
  });

  it("has a zero domain when every verified merge measured no movement, which is its own void", () => {
    const rows = impactMovementRows(buildImpactLedger([pr({ impactDim: 0, impactOverall: 0 })]));
    expect(movementDomain(rows)).toBe(0);
  });
});
