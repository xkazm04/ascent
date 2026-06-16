// Credit debit accounting — pins that the ledger's balanceAfter derives from the post-decrement
// row, not the tx's initial (possibly stale) read. Two debits whose initial reads both see the same
// stale balance must still stamp distinct, decreasing balances (9 then 8 — never 9, 9).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { consumeScanCredit, grantCredits } from "./credits";

/**
 * Fake prisma where the org row is shared mutable state, but findUnique always returns a STALE
 * snapshot (the balance before any debit in the batch) — simulating concurrent transactions under
 * READ COMMITTED whose initial reads all see the same pre-decrement value. The conditional
 * updateMany and the post-decrement re-read operate on the live row.
 */
function fakePrisma(initialBalance: number, opts: { plan?: string } = {}) {
  const row = { id: "org_1", scanCredits: initialBalance, plan: opts.plan ?? "free" };
  const staleBalance = initialBalance;
  const ledger: Array<{ delta: number; balanceAfter: number; reason: string }> = [];
  const tx = {
    organization: {
      findUnique: vi.fn(async () => ({ id: row.id, scanCredits: staleBalance, plan: row.plan })),
      findUniqueOrThrow: vi.fn(async () => ({ scanCredits: row.scanCredits })),
      updateMany: vi.fn(async () => {
        if (row.scanCredits <= 0) return { count: 0 };
        row.scanCredits -= 1;
        return { count: 1 };
      }),
    },
    creditLedger: {
      create: vi.fn(async ({ data }: { data: (typeof ledger)[number] }) => {
        ledger.push({ delta: data.delta, balanceAfter: data.balanceAfter, reason: data.reason });
        return data;
      }),
    },
  };
  return {
    prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
    row,
    ledger,
  };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("consumeScanCredit balanceAfter integrity", () => {
  it("stamps the post-decrement balance even when the initial read is stale (9 then 8, not 9, 9)", async () => {
    const { prisma, ledger, row } = fakePrisma(10);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await consumeScanCredit("acme");
    const second = await consumeScanCredit("acme");

    expect(first).toEqual({ ok: true, balance: 9, unlimited: false });
    expect(second).toEqual({ ok: true, balance: 8, unlimited: false });
    expect(ledger.map((e) => e.balanceAfter)).toEqual([9, 8]);
    expect(row.scanCredits).toBe(8);
  });

  it("returns ok:false and writes no ledger row when the conditional decrement loses", async () => {
    const { prisma, ledger } = fakePrisma(0);
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("acme");

    expect(res.ok).toBe(false);
    expect(ledger).toHaveLength(0);
  });

  it("unlimited plans never debit or write ledger rows", async () => {
    const { prisma, ledger, row } = fakePrisma(5, { plan: "enterprise" });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("acme");

    expect(res).toEqual({ ok: true, balance: 5, unlimited: true });
    expect(ledger).toHaveLength(0);
    expect(row.scanCredits).toBe(5);
  });
});

/** Fake prisma for grantCredits: findUnique reads the live row, update applies a relative increment. */
function fakePrismaForGrant(initialBalance: number) {
  const row = { id: "org_1", scanCredits: initialBalance };
  const ledger: Array<{ delta: number; balanceAfter: number; reason: string }> = [];
  const tx = {
    organization: {
      findUnique: vi.fn(async () => ({ id: row.id, scanCredits: row.scanCredits })),
      update: vi.fn(async ({ data }: { data: { scanCredits: { increment: number } } }) => {
        row.scanCredits += data.scanCredits.increment;
        return { scanCredits: row.scanCredits };
      }),
    },
    creditLedger: {
      create: vi.fn(async ({ data }: { data: (typeof ledger)[number] }) => {
        ledger.push({ delta: data.delta, balanceAfter: data.balanceAfter, reason: data.reason });
        return data;
      }),
    },
  };
  return { prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) }, row, ledger };
}

describe("grantCredits ledger invariant (negative-adjustment clamp)", () => {
  it("clamps an over-large debit and stamps the APPLIED delta, keeping prev + delta === balanceAfter", async () => {
    const { prisma, ledger, row } = fakePrismaForGrant(30);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await grantCredits("acme", -100, { reason: "adjustment" });

    // Balance clamps at 0 (never negative), and the ledger records delta=-30 (what was applied),
    // NOT the requested -30...-100 — so 30 + (-30) === 0 and the append-only trail still reconciles.
    expect(balance).toBe(0);
    expect(row.scanCredits).toBe(0);
    expect(ledger).toEqual([{ delta: -30, balanceAfter: 0, reason: "adjustment" }]);
  });

  it("applies a positive grant in full", async () => {
    const { prisma, ledger, row } = fakePrismaForGrant(10);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await grantCredits("acme", 50, { reason: "grant" });

    expect(balance).toBe(60);
    expect(row.scanCredits).toBe(60);
    expect(ledger).toEqual([{ delta: 50, balanceAfter: 60, reason: "grant" }]);
  });

  it("a debit against a zero balance is a no-op (no negative balance, no noise ledger row)", async () => {
    const { prisma, ledger, row } = fakePrismaForGrant(0);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await grantCredits("acme", -5, { reason: "adjustment" });

    expect(balance).toBe(0);
    expect(row.scanCredits).toBe(0);
    expect(ledger).toHaveLength(0);
  });
});
