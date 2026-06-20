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
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "enterprise", unlimited: true });
    expect(await checkScanEntitlement("acme")).toEqual({
      allowed: true,
      unlimited: true,
      balance: 0,
      withinAllowance: false,
    });
  });

  it("is allowed AND within-allowance under the monthly allowance, even at a zero credit balance", async () => {
    mockGetCreditState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false });
    mockCountUsage.mockResolvedValue(0); // 0 of Free's 10/mo
    expect(await checkScanEntitlement("acme")).toMatchObject({ allowed: true, withinAllowance: true });
  });

  it("once the allowance is SPENT: allowed via credits when balance > 0, blocked (402) at zero", async () => {
    mockCountUsage.mockResolvedValue(10); // Free's 10/mo allowance exhausted
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
