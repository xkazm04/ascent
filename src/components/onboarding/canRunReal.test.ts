import { describe, it, expect } from "vitest";
import { canRunRealScan } from "./canRunReal";
import type { OrgCredit } from "@/components/onboarding/OnboardingFlow";

// Pins the onboarding "money gate" — the single boolean deciding whether a scan spends
// real prepaid credits (mock:false) or runs as a disclosed preview (mock:true). Each case
// locks an invariant whose silent regression would either bill the WRONG tenant or serve a
// mock scan as if it were live.

const acme: OrgCredit = { org: "acme", balance: 5, unlimited: false };

describe("canRunRealScan", () => {
  it("returns false when sourceInstallId is missing (public funnel is always preview)", () => {
    expect(canRunRealScan({ sourceInstallId: null, credit: acme, sourceLabel: "acme" })).toBe(false);
    expect(canRunRealScan({ sourceInstallId: undefined, credit: acme, sourceLabel: "acme" })).toBe(false);
  });

  it("returns false when credit is missing", () => {
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: null, sourceLabel: "acme" })).toBe(false);
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: undefined, sourceLabel: "acme" })).toBe(false);
  });

  it("returns false when credit.org !== sourceLabel (stale credit must NOT bill the wrong tenant)", () => {
    const staleOtherTenant: OrgCredit = { org: "other", balance: 5, unlimited: false };
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: staleOtherTenant, sourceLabel: "acme" })).toBe(false);
  });

  it("returns true when org matches and the credit is unlimited", () => {
    const unlimited: OrgCredit = { org: "acme", balance: 0, unlimited: true };
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: unlimited, sourceLabel: "acme" })).toBe(true);
  });

  it("returns true when org matches and balance > 0", () => {
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: acme, sourceLabel: "acme" })).toBe(true);
  });

  it("returns false when org matches but balance === 0 and not unlimited", () => {
    const drained: OrgCredit = { org: "acme", balance: 0, unlimited: false };
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: drained, sourceLabel: "acme" })).toBe(false);
  });

  it("returns true at a 0 balance when the org still has INCLUDED free monthly scans (allowanceRemaining > 0)", () => {
    // A Free-tier org with 0 purchased credits but unused free scans is entitled to a REAL scan (the
    // server's hybrid gate allows it); the money-gate must not silently downgrade it to a preview.
    const onAllowance: OrgCredit = { org: "acme", balance: 0, unlimited: false, allowanceRemaining: 6 };
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: onAllowance, sourceLabel: "acme" })).toBe(true);
  });

  it("returns false when balance AND allowance are both exhausted (the 402/upgrade moment)", () => {
    const spent: OrgCredit = { org: "acme", balance: 0, unlimited: false, allowanceRemaining: 0 };
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit: spent, sourceLabel: "acme" })).toBe(false);
  });
});
