// reserveScanCredit must thread consumeScanCredit's orgExists:false so callers 404 a missing org
// instead of treating the skip as INSUFFICIENT_CREDITS.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockConsume, mockGrant, mockAlert } = vi.hoisted(() => ({
  mockConsume: vi.fn(),
  mockGrant: vi.fn(),
  mockAlert: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  consumeScanCredit: mockConsume,
  grantCredits: mockGrant,
  CREDIT_REASON: {
    SCAN: "scan",
    GRANT: "grant",
    ADJUSTMENT: "adjustment",
    REFUND: "refund",
    POLAR: "polar",
    POLAR_REFUND: "polar-refund",
  },
}));
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: mockAlert }));

import { reserveScanCredit } from "./scan-credit";

describe("reserveScanCredit orgExists", () => {
  beforeEach(() => {
    mockConsume.mockReset();
    mockGrant.mockReset();
    mockAlert.mockClear();
  });

  it("threads orgExists:false on a missing org — skip is not a paywall", async () => {
    mockConsume.mockResolvedValue({
      ok: false,
      balance: 0,
      unlimited: false,
      charged: false,
      orgExists: false,
    });

    const res = await reserveScanCredit("ghost", "ghost/repo");

    expect(res).toEqual({ skip: true, reserved: false, balance: 0, orgExists: false });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("omits orgExists on a real out-of-credits skip so callers still 402", async () => {
    mockConsume.mockResolvedValue({ ok: false, balance: 0, unlimited: false, charged: false });

    const res = await reserveScanCredit("acme", "acme/repo");

    expect(res).toEqual({ skip: true, reserved: false, balance: 0 });
    expect(res.orgExists).not.toBe(false);
  });

  it("does not stamp orgExists:false on a successful reserve", async () => {
    mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });

    const res = await reserveScanCredit("acme", "acme/repo", { actor: "sam" });

    expect(res).toEqual({ skip: false, reserved: true, balance: 4 });
    expect(res.orgExists).not.toBe(false);
  });
});
