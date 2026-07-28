import { describe, it, expect } from "vitest";
import { retentionCutoff, planFeatures, planAllowsWhiteLabel, planAllowsPdfExport, planPriceLabel, scanAllowance, decideScanCharge, PLAN_FEATURES } from "./plans";

const NOW = Date.UTC(2026, 5, 20); // fixed clock so the cutoff math is deterministic
const DAY = 86_400_000;

describe("retentionCutoff (non-destructive read floor)", () => {
  it("clamps Free to 30 days back", () => {
    expect(retentionCutoff("free", NOW)).toEqual(new Date(NOW - 30 * DAY));
  });

  it("clamps Pro to 180 and Team to 365 days back", () => {
    expect(retentionCutoff("pro", NOW)).toEqual(new Date(NOW - 180 * DAY));
    expect(retentionCutoff("team", NOW)).toEqual(new Date(NOW - 365 * DAY));
  });

  it("returns null (unlimited, no floor) for Enterprise", () => {
    expect(PLAN_FEATURES.enterprise.retentionDays).toBeNull();
    expect(retentionCutoff("enterprise", NOW)).toBeNull();
  });

  it("treats unknown/blank plans as Free", () => {
    expect(retentionCutoff(null, NOW)).toEqual(new Date(NOW - 30 * DAY));
    expect(retentionCutoff("bogus", NOW)).toEqual(new Date(NOW - planFeatures("free").retentionDays! * DAY));
  });
});

describe("planAllowsWhiteLabel — Team and up", () => {
  it("allows Team and Enterprise, denies Free/Pro/unknown", () => {
    expect(planAllowsWhiteLabel("team")).toBe(true);
    expect(planAllowsWhiteLabel("enterprise")).toBe(true);
    expect(planAllowsWhiteLabel("pro")).toBe(false);
    expect(planAllowsWhiteLabel("free")).toBe(false);
    expect(planAllowsWhiteLabel(null)).toBe(false);
    expect(planAllowsWhiteLabel("bogus")).toBe(false);
  });
});

describe("planAllowsPdfExport — Pro and up (g1-02)", () => {
  it("allows Pro, Team, and Enterprise, denies Free/unknown", () => {
    expect(planAllowsPdfExport("pro")).toBe(true);
    expect(planAllowsPdfExport("team")).toBe(true);
    expect(planAllowsPdfExport("enterprise")).toBe(true);
    expect(planAllowsPdfExport("free")).toBe(false);
    expect(planAllowsPdfExport(null)).toBe(false);
    expect(planAllowsPdfExport("bogus")).toBe(false);
  });
});

describe("scanAllowance — monthly metered-scan allowance per tier", () => {
  it("is 5 / 100 / 500, and null (unlimited) for Enterprise", () => {
    expect(scanAllowance("free")).toBe(5);
    expect(scanAllowance("pro")).toBe(100);
    expect(scanAllowance("team")).toBe(500);
    expect(scanAllowance("enterprise")).toBeNull();
    expect(scanAllowance(null)).toBe(5); // unknown → free
  });
});

describe("planPriceLabel — subscription display prices", () => {
  it("Free is $0, Pro $10/mo, Team $20/mo, Enterprise Custom", () => {
    expect(planPriceLabel("free")).toEqual({ amount: "$0", cadence: "free forever" });
    expect(planPriceLabel("pro")).toEqual({ amount: "$10", cadence: "/ month" });
    expect(planPriceLabel("team")).toEqual({ amount: "$20", cadence: "/ month" });
    expect(planPriceLabel("enterprise")).toEqual({ amount: "Custom", cadence: "contact us" });
  });

  it("Pro and Team are subscriptions; Free is free; Enterprise is custom", () => {
    expect(PLAN_FEATURES.pro.billing).toBe("subscription");
    expect(PLAN_FEATURES.team.billing).toBe("subscription");
    expect(PLAN_FEATURES.free.billing).toBe("free");
    expect(PLAN_FEATURES.enterprise.billing).toBe("custom");
  });
});

describe("decideScanCharge — hybrid: allowance, then a credit, then denied", () => {
  it("unlimited is always free, ignoring usage/balance", () => {
    expect(decideScanCharge({ unlimited: true, allowance: 0, usageThisMonth: 9999, balance: 0 })).toBe("unlimited");
  });
  it("is free while under the monthly allowance", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 0, balance: 0 })).toBe("allowance");
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 9, balance: 0 })).toBe("allowance");
  });
  it("draws a credit once the allowance is spent (and credits remain)", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 10, balance: 3 })).toBe("credit");
  });
  it("is denied (the 402) when the allowance is spent AND there are no credits", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 10, usageThisMonth: 10, balance: 0 })).toBe("denied");
  });
  it("a zero allowance falls straight to credits / denied", () => {
    expect(decideScanCharge({ unlimited: false, allowance: 0, usageThisMonth: 0, balance: 1 })).toBe("credit");
    expect(decideScanCharge({ unlimited: false, allowance: 0, usageThisMonth: 0, balance: 0 })).toBe("denied");
  });
});

describe("marketing copy matches the metering engine (checkout-plans-polar 07-16 #5)", () => {
  // The engine (src/lib/db/credits.ts, decideScanCharge callers) meters only PRIVATE (org) scans;
  // public scans are free and unmetered. The plan cards' copy must never re-claim the old
  // "public or private" allowance model — the CreditMatrixLedger on the same /pricing page states
  // the opposite, and a visitor comparing the two blocks would see a direct contradiction.
  it("no plan blurb or feature line claims public scans draw the allowance", () => {
    for (const p of Object.values(PLAN_FEATURES)) {
      for (const text of [p.blurb, ...p.features]) {
        expect(text.toLowerCase()).not.toContain("public or private");
      }
    }
  });
  it("the Free tier pitches the real model: private scans metered, public scans always free", () => {
    expect(PLAN_FEATURES.free.blurb).toMatch(/private scans/i);
    expect(PLAN_FEATURES.free.blurb).toMatch(/public scans are always free/i);
  });
});
