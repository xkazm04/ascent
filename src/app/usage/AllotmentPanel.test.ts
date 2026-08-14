// allotmentRead turns "credits burned" into "X% of your monthly allotment" — the right-sizing signal.
//
// Every case is expressed as a FRACTION of the tier's allotment rather than as a literal scan count.
// These tests previously hardcoded 500 (Team) and 100 (Pro), which made them a second place to edit on
// a repricing — and the 2026-08-14 repricing duly broke all four while the function itself was correct.
// The behaviour under test is the normalization and the fit thresholds, not any particular allowance.

import { describe, it, expect } from "vitest";
import { allotmentRead } from "./AllotmentPanel";
import { PLAN_FEATURES, scanAllowance } from "@/lib/plans";

const TEAM = scanAllowance("team")!;

/** Billable scans over `days` that sustain a monthly rate of `pct`% of the tier's allotment. */
const burnFor = (allotment: number, pct: number, days: number) => (allotment * pct) / 100 / 30 * days;

describe("allotmentRead — burn-vs-allotment right-sizing", () => {
  it("returns null only for the unlimited tier; Free has its allowance to track", () => {
    expect(allotmentRead("enterprise", 5000, 30)).toBeNull();
    const freeAllot = scanAllowance("free")!;
    const free = allotmentRead("free", freeAllot, 30)!;
    expect(free.included).toBe(freeAllot);
    expect(free.monthlyBurn).toBe(freeAllot);
  });

  it("normalizes the period burn to a monthly rate (window-independent %)", () => {
    // The SAME sustained rate over a 90-day window must read as the same monthly burn and the same
    // percentage as over 30 days — that window-independence is the whole point of the normalization.
    const over30 = allotmentRead("team", burnFor(TEAM, 60, 30), 30)!;
    const over90 = allotmentRead("team", burnFor(TEAM, 60, 90), 90)!;
    expect(over30.included).toBe(TEAM);
    expect(over90.included).toBe(TEAM);
    expect(over90.monthlyBurn).toBe(over30.monthlyBurn);
    expect(over90.pct).toBe(60);
    expect(over30.pct).toBe(60);
  });

  it("labels the read with the tier's customer-facing name", () => {
    expect(allotmentRead("pro", 1, 30)!.label).toBe(PLAN_FEATURES.pro.label);
  });

  it("flags 'under' (downgrade hint) when sustained burn is < 25% of allotment", () => {
    expect(allotmentRead("team", burnFor(TEAM, 12, 30), 30)!.fit).toBe("under");
  });

  it("flags 'over' (top-up/upgrade before the 402) when burn exceeds 90% of allotment", () => {
    const r = allotmentRead("team", burnFor(TEAM, 95, 30), 30)!;
    expect(r.pct).toBe(95);
    expect(r.fit).toBe("over");
  });

  it("is 'ok' in the comfortable middle, and never 'under' at zero burn (nothing to right-size yet)", () => {
    expect(allotmentRead("team", burnFor(TEAM, 50, 30), 30)!.fit).toBe("ok");
    expect(allotmentRead("team", 0, 30)!.fit).toBe("ok"); // 0 burn → not an idle-downgrade signal
  });
});
