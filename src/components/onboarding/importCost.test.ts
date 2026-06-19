// Locks the watch-schedule cost-disclosure contract (Test Mastery finding #3, HIGH).
//
// The select step DISCLOSES a recurring monthly credit cost at the exact moment it commits the
// selected repos to a `watch:true, schedule:IMPORT_WATCH_SCHEDULE` autoscan. The prior wave's
// importScan.test.ts pins the POST BODY (watch:true / schedule === IMPORT_WATCH_SCHEDULE / mock).
// This file pins the OTHER half the finding flags and that test does NOT cover:
//   1. the `?? 0` silent-zero trap — the committed cadence must have a DEFINED POSITIVE rate in
//      MONTHLY_RUNS, so a real recurring charge can never be disclosed as 0 credits/month;
//   2. the disclosed cost == selected.size × that rate, derived from the SAME committed cadence the
//      POST sends — so the number shown to the user can't drift from the number the POST charges.
// The arithmetic lived inline in the "use client" select step; it was extracted verbatim into
// importCost.ts (behaviour-preserving) so it is testable in this jsdom-less Node harness.

import { describe, it, expect } from "vitest";
import {
  IMPORT_WATCH_MONTHLY_RATE,
  importWatchMonthlyCredits,
} from "./importCost";
import { IMPORT_WATCH_SCHEDULE } from "./importScan";
import { MONTHLY_RUNS } from "@/lib/credit-estimate";

describe("import watch cost-disclosure contract", () => {
  it("the committed schedule has a DEFINED, POSITIVE monthly rate (no `?? 0` silent-zero)", () => {
    // The trap: if IMPORT_WATCH_SCHEDULE ever drifts out of MONTHLY_RUNS, the lookup is
    // `undefined ?? 0` and the disclosure renders a real recurring charge as 0 credits/month.
    const rate = MONTHLY_RUNS[IMPORT_WATCH_SCHEDULE];
    expect(rate, `MONTHLY_RUNS has no rate for committed schedule "${IMPORT_WATCH_SCHEDULE}"`)
      .toBeTypeOf("number");
    expect(rate).toBeGreaterThan(0);
    // And the derived constant the disclosure uses must equal that real rate — never the 0 fallback.
    expect(IMPORT_WATCH_MONTHLY_RATE).toBe(rate);
    expect(IMPORT_WATCH_MONTHLY_RATE).toBeGreaterThan(0);
  });

  it("disclosed cost == selected count × the COMMITTED schedule's rate (copy can't drift from the POST)", () => {
    // The number shown to the user is derived from IMPORT_WATCH_SCHEDULE — the same constant the
    // POST body sends — so the disclosure and the commitment track one source of truth.
    const rate = MONTHLY_RUNS[IMPORT_WATCH_SCHEDULE]!;
    for (const count of [0, 1, 2, 5, 10]) {
      expect(importWatchMonthlyCredits(count)).toBe(count * rate);
    }
  });

  it("discloses zero ONLY for an empty selection — never for a non-empty commitment", () => {
    // A 0 must mean "nothing selected", never "a real recurring charge we failed to price".
    expect(importWatchMonthlyCredits(0)).toBe(0);
    expect(importWatchMonthlyCredits(1)).toBeGreaterThan(0);
  });
});
