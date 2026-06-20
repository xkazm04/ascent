import { describe, it, expect } from "vitest";
import { retentionCutoff, planFeatures, planAllowsWhiteLabel, scanAllowance, decideScanCharge, PLAN_FEATURES } from "./plans";

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

describe("scanAllowance — monthly metered-scan allowance per tier", () => {
  it("is 10 / 100 / 500, and null (unlimited) for Enterprise", () => {
    expect(scanAllowance("free")).toBe(10);
    expect(scanAllowance("pro")).toBe(100);
    expect(scanAllowance("team")).toBe(500);
    expect(scanAllowance("enterprise")).toBeNull();
    expect(scanAllowance(null)).toBe(10); // unknown → free
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
