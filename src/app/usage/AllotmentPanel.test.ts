// allotmentRead turns calendar-month metered usage into "X% of your monthly allotment".
//
// Every case is expressed as a FRACTION of the tier's allotment rather than as a literal scan count.
// These tests previously hardcoded 500 (Team) and 100 (Pro), which made them a second place to edit on
// a repricing — and the 2026-08-14 repricing duly broke all four while the function itself was correct.
// The behaviour under test is the calendar-month numerator and the fit thresholds, not any particular
// allowance, and not a rolling-window projection of the page's ?days= billable tile.

import { describe, it, expect } from "vitest";
import { ALLOTMENT_CURRENCIES_NOTE, allotmentRead } from "./AllotmentPanel";
import { PLAN_FEATURES, scanAllowance } from "@/lib/plans";

const TEAM = scanAllowance("team")!;

/** Calendar-month metered scans that are `pct`% of the tier's allotment. */
const usedFor = (allotment: number, pct: number) => Math.round((allotment * pct) / 100);

describe("allotmentRead — burn-vs-allotment right-sizing", () => {
  it("returns null only for the unlimited tier; Free has its allowance to track", () => {
    expect(allotmentRead("enterprise", 5000)).toBeNull();
    const freeAllot = scanAllowance("free")!;
    const free = allotmentRead("free", freeAllot)!;
    expect(free.included).toBe(freeAllot);
    expect(free.usedThisMonth).toBe(freeAllot);
  });

  it("uses calendar-month metered usage as the numerator, not a rolling billable-scan window", () => {
    // 12% of Team this month is 12%. The old panel annualized the page's ?days= window to 30: the
    // same count over a 7-day window would have read as ~51% "at this pace".
    const used = usedFor(TEAM, 12);
    const r = allotmentRead("team", used)!;
    expect(r.usedThisMonth).toBe(used);
    expect(r.pct).toBe(12);
    const windowedProjection = Math.round((used / 7) * 30);
    expect(r.usedThisMonth).not.toBe(windowedProjection);
    expect(r.pct).not.toBe(Math.round((windowedProjection / TEAM) * 100));
  });

  it("does not annualize a 90-day window down to a monthly rate", () => {
    // Old: allotmentRead(plan, used, 90) → monthlyBurn = used/90*30, so 60% of a month over 90d
    // read as 20%. New: the count IS the month-to-date numerator.
    const used = usedFor(TEAM, 60);
    const r = allotmentRead("team", used)!;
    expect(r.usedThisMonth).toBe(used);
    expect(r.pct).toBe(60);
    expect(Math.round((used / 90) * 30)).not.toBe(used);
  });

  it("labels the read with the tier's customer-facing name", () => {
    expect(allotmentRead("pro", 1)!.label).toBe(PLAN_FEATURES.pro.label);
  });

  it("flags 'under' (downgrade hint) when month-to-date usage is < 25% of allotment", () => {
    expect(allotmentRead("team", usedFor(TEAM, 12))!.fit).toBe("under");
  });

  it("flags 'over' (top-up/upgrade before the 402) when usage exceeds 90% of allotment", () => {
    const r = allotmentRead("team", usedFor(TEAM, 95))!;
    expect(r.pct).toBe(95);
    expect(r.fit).toBe("over");
  });

  it("is 'ok' in the comfortable middle, and never 'under' at zero burn (nothing to right-size yet)", () => {
    expect(allotmentRead("team", usedFor(TEAM, 50))!.fit).toBe("ok");
    expect(allotmentRead("team", 0)!.fit).toBe("ok"); // 0 burn → not an idle-downgrade signal
  });
});

// MC-B21 (VICTOR-L1-01): "Unused credits roll over. They never expire" sat under a header reading
// "Monthly allotment · N credits / mo". Both clauses were true, of two different currencies — and the
// one the meter above them measures is the one that does NOT roll over.
describe("the allotment note names both currencies", () => {
  it("says the monthly allotment resets and only prepaid credits roll over", () => {
    expect(ALLOTMENT_CURRENCIES_NOTE).toMatch(/monthly allotment resets/i);
    expect(ALLOTMENT_CURRENCIES_NOTE).toMatch(/prepaid credits[^.]*roll over/i);
  });

  it("never says roll-over without naming which currency rolls over", () => {
    // The regression shape: an unqualified "credits roll over" under a meter of the allotment.
    expect(ALLOTMENT_CURRENCIES_NOTE).not.toMatch(/(?<!prepaid )credits (roll over|never expire)/i);
  });
});
