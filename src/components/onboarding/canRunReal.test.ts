import { describe, it, expect, vi } from "vitest";
import { canRunRealPublicScan, canRunRealScan } from "./canRunReal";
import { importWatchMonthlyCredits } from "./importCost";
import { resolveScanMode } from "./scanMode";
import type { OrgCredit } from "@/components/onboarding/OnboardingFlow";

// Pins the onboarding "money gate" — the single boolean deciding whether a scan spends
// real prepaid credits (mock:false) or runs as a disclosed preview (mock:true). Each case
// locks an invariant whose silent regression would either bill the WRONG tenant or serve a
// mock scan as if it were live.

const acme: OrgCredit = { org: "acme", balance: 5, unlimited: false };

describe("canRunRealScan", () => {
  // NOTE (G7-17): this stays false for the PUBLIC path — but that no longer means "preview". The
  // public path is now decided by canRunRealPublicScan (below) and runs for REAL against the free
  // monthly public-scan allowance; canRunRealScan is specifically the CREDIT gate, and the public path
  // never draws a credit. See scanMode.resolveScanMode, which routes the two.
  it("returns false when sourceInstallId is missing (no credit path without an installation)", () => {
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

describe("the gate and the cost disclosure share ONE free-allowance source of truth (finding #1)", () => {
  it("when the gate qualifies a 0-balance org purely via allowance, the disclosure nets that SAME band", () => {
    const allowanceRemaining = 8;
    const credit: OrgCredit = { org: "acme", balance: 0, unlimited: false, allowanceRemaining };
    // The gate says "real scan" on the free allowance alone…
    expect(canRunRealScan({ sourceInstallId: "inst_1", credit, sourceLabel: "acme" })).toBe(true);
    // …so the recurring-cost disclosure must credit that same allowance, not the raw cadence — no more
    // inflated figure for the exact org the gate just qualified for a free scan.
    expect(importWatchMonthlyCredits(10, allowanceRemaining)).toBeLessThan(importWatchMonthlyCredits(10, 0));
  });
});

// G7-17: the public-handle funnel's first run must be REAL, not fabricated. `/report?repo=` already
// scores a public repo for real with no account and no credits (metered by the monthly allowance);
// the onboarding funnel is the same work on the same kind of repo, and its mock results were flowing
// into the public corpus that the public register ranks.
describe("canRunRealPublicScan", () => {
  it("is TRUE exactly when there is no installation (token-less ⇒ public repos only)", () => {
    expect(canRunRealPublicScan({ sourceInstallId: null })).toBe(true);
    expect(canRunRealPublicScan({ sourceInstallId: undefined })).toBe(true);
    expect(canRunRealPublicScan({ sourceInstallId: "inst_1" })).toBe(false);
  });
});

describe("resolveScanMode — the public path settles without touching credits", () => {
  it("returns a real, public-funnel decision and never reads a balance", async () => {
    const fetchCredit = vi.fn(async () => null);
    const decision = await resolveScanMode({
      sourceInstallId: null,
      sourceLabel: "facebook",
      credit: null,
      creditReady: { current: null },
      fetchCredit,
    });
    expect(decision).toEqual({ canRunReal: true, creditUnknown: false, publicFunnel: true });
    expect(fetchCredit).not.toHaveBeenCalled();
  });

  it("still fails CLOSED to a preview on the App path when the balance is unknown", async () => {
    const fetchCredit = vi.fn(async () => "failed" as const);
    const decision = await resolveScanMode({
      sourceInstallId: "inst_1",
      sourceLabel: "acme",
      credit: null,
      creditReady: { current: Promise.resolve("failed" as const) },
      fetchCredit,
    });
    expect(decision).toEqual({ canRunReal: false, creditUnknown: true, publicFunnel: false });
  });
});
