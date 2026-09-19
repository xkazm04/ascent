// scanCreditGate must 404 a missing org (orgExists:false) instead of payment_required / 402.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockMetered, mockEnt, mockReserve } = vi.hoisted(() => ({
  mockMetered: vi.fn(() => true),
  mockEnt: vi.fn(),
  mockReserve: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ recordQuotaEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: mockMetered,
  checkScanEntitlement: mockEnt,
}));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: mockReserve,
  refundScanCredit: vi.fn(async () => null),
}));

import { scanCreditGate } from "./scan-gates";

const entitled = {
  allowed: true,
  unlimited: false,
  balance: 5,
  withinAllowance: false,
  allowanceRemaining: 0,
  orgExists: true,
};

describe("scanCreditGate missing-org vs paywall", () => {
  beforeEach(() => {
    mockMetered.mockReturnValue(true);
    mockEnt.mockReset();
    mockReserve.mockReset();
    mockEnt.mockResolvedValue(entitled);
    mockReserve.mockResolvedValue({ skip: false, reserved: true, balance: 4 });
  });

  it("returns not_found when entitlement says orgExists:false — never payment_required", async () => {
    mockEnt.mockResolvedValue({
      allowed: false,
      unlimited: false,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: 0,
      orgExists: false,
    });

    const res = await scanCreditGate("ghost", { mock: false, repoFullName: "ghost/repo" });

    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(mockReserve).not.toHaveBeenCalled();
  });

  it("returns payment_required when a real org is out of credits", async () => {
    mockEnt.mockResolvedValue({
      allowed: false,
      unlimited: false,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: 0,
      orgExists: true,
    });

    const res = await scanCreditGate("acme", { mock: false, repoFullName: "acme/repo" });

    expect(res).toEqual({ ok: false, reason: "payment_required", balance: 0 });
  });

  it("returns not_found when the reservation reports orgExists:false after the read passed", async () => {
    mockReserve.mockResolvedValue({ skip: true, reserved: false, balance: 0, orgExists: false });

    const res = await scanCreditGate("acme", { mock: false, repoFullName: "acme/repo" });

    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns payment_required when the reservation skips without orgExists:false", async () => {
    mockReserve.mockResolvedValue({ skip: true, reserved: false, balance: 0 });

    const res = await scanCreditGate("acme", { mock: false, repoFullName: "acme/repo" });

    expect(res).toEqual({ ok: false, reason: "payment_required", balance: 0 });
  });
});
