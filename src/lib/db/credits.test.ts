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

import { consumeScanCredit } from "./credits";

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
