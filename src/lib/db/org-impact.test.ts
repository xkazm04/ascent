import { describe, expect, it } from "vitest";
import { buildImpactLedger, type ImpactPrInput } from "./org-impact";

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

describe("buildImpactLedger", () => {
  it("counts verified movement and the repos it moved", () => {
    const l = buildImpactLedger([pr(), pr({ repoFullName: "acme/api", prNumber: 2, impactDim: 4 })]);
    expect(l.mergedCount).toBe(2);
    expect(l.verifiedCount).toBe(2);
    expect(l.awaitingRescan).toBe(0);
    expect(l.reposMoved).toBe(2);
    expect(l.dimPoints).toBe(10);
  });

  // RULE 1 — a projection is not a purchase. A merged PR whose post-merge rescan hasn't landed is
  // named, not counted.
  it("excludes unrescanned merges from the totals and names them", () => {
    const l = buildImpactLedger([pr(), pr({ prNumber: 2, verifiedScanId: null, impactDim: null })]);
    expect(l.mergedCount).toBe(2);
    expect(l.verifiedCount).toBe(1);
    expect(l.awaitingRescan).toBe(1);
    expect(l.dimPoints).toBe(6); // only the verified row
  });

  // RULE 2 — the difference between "delivered nothing" and "haven't measured yet" is the whole
  // credibility of the panel. Nothing verified must render as null, never as a confident 0.
  it("reports null points — not zero — when nothing is verified", () => {
    const l = buildImpactLedger([pr({ verifiedScanId: null, impactDim: null })]);
    expect(l.dimPoints).toBeNull();
    expect(l.verifiedCount).toBe(0);
    expect(l.byDim).toEqual([]);
  });

  it("reports null points when every verified row lacks a baseline", () => {
    const l = buildImpactLedger([pr({ impactDim: null }), pr({ prNumber: 2, impactDim: null })]);
    expect(l.verifiedCount).toBe(2);
    expect(l.unmeasurable).toBe(2);
    expect(l.dimPoints).toBeNull();
  });

  it("counts a verified-but-baseline-less row as unmeasurable, not as a zero contribution", () => {
    const l = buildImpactLedger([pr({ impactDim: 5 }), pr({ prNumber: 2, impactDim: null })]);
    expect(l.verifiedCount).toBe(2);
    expect(l.unmeasurable).toBe(1);
    expect(l.dimPoints).toBe(5);
    expect(l.byDim).toEqual([{ dimId: "D1", points: 5, prs: 1 }]);
  });

  // RULE 3 — a regression must never disappear inside a positive total.
  it("surfaces regressions separately while keeping the total sign-aware", () => {
    const l = buildImpactLedger([pr({ impactDim: 8 }), pr({ prNumber: 2, impactDim: -3 })]);
    expect(l.dimPoints).toBe(5);
    expect(l.regressions).toBe(1);
  });

  it("can report a net-negative period rather than hiding it", () => {
    const l = buildImpactLedger([pr({ impactDim: -4 }), pr({ prNumber: 2, impactDim: -1 })]);
    expect(l.dimPoints).toBe(-5);
    expect(l.regressions).toBe(2);
  });

  it("groups by dimension, biggest lift first", () => {
    const l = buildImpactLedger([
      pr({ dimId: "D2", impactDim: 3 }),
      pr({ prNumber: 2, dimId: "D5", impactDim: 9 }),
      pr({ prNumber: 3, dimId: "D2", impactDim: 4 }),
    ]);
    expect(l.byDim).toEqual([
      { dimId: "D5", points: 9, prs: 1 },
      { dimId: "D2", points: 7, prs: 2 },
    ]);
  });

  it("orders rows newest merge first and drops rows with no merge timestamp", () => {
    const l = buildImpactLedger([
      pr({ prNumber: 1, mergedAt: new Date("2026-08-01T00:00:00Z") }),
      pr({ prNumber: 2, mergedAt: new Date("2026-08-09T00:00:00Z") }),
      pr({ prNumber: 3, mergedAt: null }),
    ]);
    expect(l.rows.map((r) => r.prNumber)).toEqual([2, 1]);
    expect(l.mergedCount).toBe(2);
  });

  it("resolves the practice label and the short repo name", () => {
    const [row] = buildImpactLedger([pr({ repoFullName: "acme/web-app" })]).rows;
    expect(row!.repoName).toBe("web-app");
    expect(row!.practiceLabel).not.toBe("agent-guidance"); // resolved through the PRACTICES catalog
  });

  it("falls back to the raw practice id when the catalog no longer carries it", () => {
    const [row] = buildImpactLedger([pr({ practiceId: "retired-practice" })]).rows;
    expect(row!.practiceLabel).toBe("retired-practice");
  });

  it("is empty-safe", () => {
    const l = buildImpactLedger([]);
    expect(l).toMatchObject({ mergedCount: 0, verifiedCount: 0, reposMoved: 0, dimPoints: null, regressions: 0 });
    expect(l.rows).toEqual([]);
  });
});
