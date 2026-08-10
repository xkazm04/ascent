import { describe, it, expect } from "vitest";
import { creditNotice } from "./creditNotice";

// UAT DANA-L1-003 — the two defects L2 executed branch-by-branch, pinned as tests.

const free = (usageThisMonth: number, balance: number, billableInPeriod = 0) =>
  creditNotice({ plan: "free", unlimited: false, usageThisMonth, balance, billableInPeriod });

describe("creditNotice — the banner may only warn about a refusal billing would actually issue", () => {
  it("is SILENT for a brand-new org (0 credits, 0 scans) — the default state of every new org", () => {
    // The regression that mattered: scanCredits DEFAULT 0 made the harshest alarm the default, while
    // AllotmentPanel said "comfortably within your 5/mo Free allotment" on the same page.
    expect(free(0, 0)).toBeNull();
  });

  it("is silent anywhere inside the monthly allowance, whatever the credit balance", () => {
    for (let usage = 0; usage < 5; usage++) {
      expect(free(usage, 0)).toBeNull();
      expect(free(usage, 3)).toBeNull();
    }
  });

  it("says 'denied' only when the allowance is spent AND there are no credits — the real 402", () => {
    const n = free(5, 0);
    expect(n).toEqual({ kind: "denied", balance: 0, allowanceRemaining: 0 });
  });

  it("is MONOTONIC in the balance: denied -> low -> silent as credits rise, never back again", () => {
    // The old predicate did the opposite at the bottom: 0 credits shouted, 1 credit was silent.
    const rank = { denied: 2, low: 1, none: 0 } as const;
    const severity = (balance: number) => {
      const n = creditNotice({ plan: "free", unlimited: false, usageThisMonth: 5, balance, billableInPeriod: 4 });
      return rank[n?.kind ?? "none"];
    };
    const series = [0, 1, 2, 3, 4, 5, 6, 10, 50].map(severity);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThanOrEqual(series[i - 1]);
    expect(series[0]).toBe(rank.denied);
    expect(series.at(-1)).toBe(rank.none);
  });

  it("warns 'low' while drawing on credits that won't cover the observed burn", () => {
    expect(free(5, 3, 5)).toEqual({ kind: "low", balance: 3, allowanceRemaining: 0 });
  });

  it("does not warn on a positive balance with no burn behind it — an unactionable warning is noise", () => {
    expect(free(5, 3, 0)).toBeNull();
  });

  it("never warns on an unlimited plan", () => {
    expect(creditNotice({ plan: "enterprise", unlimited: true, usageThisMonth: 9999, balance: 0, billableInPeriod: 9999 })).toBeNull();
  });
});
