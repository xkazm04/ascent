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

import { refundScanCredit, reserveScanCredit } from "./scan-credit";

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

    expect(res).toEqual({ skip: false, reserved: true, balance: 4, reservationKey: expect.stringMatching(/^scan-hold:/) });
    expect(res.orgExists).not.toBe(false);
  });
});

// The reservation names itself, and the refund names the reservation (refund:<debitKey>), so a
// refund is idempotent per DEBIT rather than per invocation. And the refund reports the truth: a
// grant that failed is `refunded:false`, never a silent success the caller settles on.
describe("reserveScanCredit / refundScanCredit keyed reservation", () => {
  beforeEach(() => {
    mockConsume.mockReset();
    mockGrant.mockReset();
  });

  it("debits on the caller's reservation key and hands it back", async () => {
    mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });
    const res = await reserveScanCredit("acme", "acme/repo", { actor: "queue:manual", reservationKey: "scan-job:J:1" });
    expect(mockConsume).toHaveBeenCalledWith("acme", expect.objectContaining({ reservationKey: "scan-job:J:1" }));
    expect(res).toMatchObject({ skip: false, reserved: true, reservationKey: "scan-job:J:1" });
  });

  it("mints a scan-hold:<uuid> key when the caller has none", async () => {
    mockConsume.mockResolvedValue({ ok: true, balance: 4, unlimited: false, charged: true });
    const res = await reserveScanCredit("acme", "acme/repo");
    expect(res.reservationKey).toMatch(/^scan-hold:[0-9a-f-]{36}$/);
    expect(mockConsume.mock.calls[0]![1]).toMatchObject({ reservationKey: res.reservationKey });
  });

  it("refunds on refund:<debitKey> and reports refunded:true with the balance", async () => {
    mockGrant.mockResolvedValue(5);
    const out = await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1", repoFullName: "acme/repo" });
    expect(mockGrant).toHaveBeenCalledWith("acme", 1, expect.objectContaining({ externalId: "refund:scan-job:J:1" }));
    expect(out).toEqual({ refunded: true, balance: 5 });
  });

  it("a grant that throws is refunded:false, balance:null - never reported as refunded", async () => {
    mockGrant.mockRejectedValue(new Error("connection reset"));
    expect(await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1" })).toEqual({ refunded: false, balance: null });
  });

  it("a grant that finds no org is refunded:false", async () => {
    mockGrant.mockResolvedValue(null);
    expect(await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1" })).toEqual({ refunded: false, balance: null });
  });

  it("nothing reserved: no grant, refunded:false", async () => {
    expect(await refundScanCredit("acme", false, { reservationKey: "scan-job:J:1" })).toEqual({ refunded: false, balance: null });
    expect(mockGrant).not.toHaveBeenCalled();
  });
});
