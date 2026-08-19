// The metered-scan policy: what counts as a billable scan, when an org is entitled to run one, and
// the 402 shape. Credit state + DB config are mocked so the policy is tested in isolation.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetCreditState, mockIsDbConfigured, mockCountUsage } = vi.hoisted(() => ({
  mockGetCreditState: vi.fn(),
  mockIsDbConfigured: vi.fn(),
  mockCountUsage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured }));
vi.mock("@/lib/db/credits", () => ({
  getCreditState: mockGetCreditState,
  countMeteredScansThisMonth: mockCountUsage,
}));

import { checkScanEntitlement, isMeteredScan, paymentRequired } from "./entitlement";
import { scanAllowance } from "@/lib/plans";

// The Free tier's monthly allowance, read from the plan model. These tests assert what happens AT the
// allowance boundary, so the literal was only ever a stand-in for "the boundary" — and it turned each
// of them into a repricing tripwire. Non-null asserted: Free is metered by definition, and a change
// to that IS something these tests should fail on.
const FREE_ALLOWANCE = scanAllowance("free") as number;

beforeEach(() => {
  mockGetCreditState.mockReset();
  mockIsDbConfigured.mockReset();
  mockCountUsage.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  mockCountUsage.mockResolvedValue(0); // default: no metered scans yet this month
});

describe("isMeteredScan", () => {
  it("public, mock, and no-DB scans are free", () => {
    expect(isMeteredScan("public", false)).toBe(false);
    expect(isMeteredScan("acme", true)).toBe(false);
    mockIsDbConfigured.mockReturnValue(false);
    expect(isMeteredScan("acme", false)).toBe(false);
  });

  it("a private, non-mock scan with a DB is metered", () => {
    expect(isMeteredScan("acme", false)).toBe(true);
  });
});

describe("checkScanEntitlement (hybrid: allowance, then credits)", () => {
  it("an unlimited plan is always allowed regardless of balance/usage", async () => {
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "enterprise", unlimited: true, orgExists: true });
    expect(await checkScanEntitlement("acme")).toEqual({
      allowed: true,
      unlimited: true,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: Infinity,
      orgExists: true,
    });
  });

  it("an unknown org (orgExists:false) is DENIED — read gate agrees with the write gate, not a phantom free scan", async () => {
    // A deleted/typo'd slug: getCreditState returns the $0/free shape but orgExists:false. With usage 0 <
    // the free allowance the old gate reported allowed:true/withinAllowance:true — a phantom org looked
    // entitled while consumeScanCredit (the write gate) denied it. Now both deny.
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false, orgExists: false });
    mockCountUsage.mockResolvedValue(0);
    expect(await checkScanEntitlement("ghost")).toEqual({
      allowed: false,
      unlimited: false,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: 0,
      orgExists: false,
    });
  });

  it("allowanceRemaining = the monthly free scans left (the batch-cap input that was missing)", async () => {
    // A Free org one scan short of its allowance, with 0 credits bought, still has 1 FREE scan left —
    // so a bulk scan/import must be sized to balance + allowanceRemaining (1), not balance (0).
    // Capping on credits alone wrongly skipped every included free scan.
    //
    // The allowance is read from the plan model rather than written as a literal: this test is about
    // the ARITHMETIC at the boundary, not about the Free tier's current volume, and hard-coding the
    // number made it a tripwire that fired on a repricing while the behaviour never changed.
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false });
    mockCountUsage.mockResolvedValue(FREE_ALLOWANCE - 1);
    expect(await checkScanEntitlement("acme")).toMatchObject({ balance: 0, allowanceRemaining: 1 });
    // Allowance fully spent ⇒ 0 remaining (overflow then draws on credits only).
    mockCountUsage.mockResolvedValue(FREE_ALLOWANCE);
    expect((await checkScanEntitlement("acme")).allowanceRemaining).toBe(0);
  });

  it("is allowed AND within-allowance under the monthly allowance, even at a zero credit balance", async () => {
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false });
    mockCountUsage.mockResolvedValue(0); // 0 of Free's 5/mo
    expect(await checkScanEntitlement("acme")).toMatchObject({ allowed: true, withinAllowance: true });
  });

  it("once the allowance is SPENT: allowed via credits when balance > 0, blocked (402) at zero", async () => {
    mockCountUsage.mockResolvedValue(FREE_ALLOWANCE); // Free's monthly allowance exhausted
    mockGetCreditState.mockResolvedValue({ balance: 3, plan: "free", unlimited: false });
    expect(await checkScanEntitlement("acme")).toMatchObject({ allowed: true, withinAllowance: false });
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false });
    expect((await checkScanEntitlement("acme")).allowed).toBe(false);
  });
});

describe("paymentRequired", () => {
  it("is a 402 carrying the code and balance", async () => {
    const res = paymentRequired(0);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
    expect(body.balance).toBe(0);
  });
});
