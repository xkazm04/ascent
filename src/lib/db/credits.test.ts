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
import { isUnlimitedPlan, PLAN_ORDER } from "@/lib/plans";

/**
 * Fake prisma where the org row is shared mutable state, but findUnique always returns a STALE
 * snapshot (the balance before any debit in the batch) — simulating concurrent transactions under
 * READ COMMITTED whose initial reads all see the same pre-decrement value. The conditional
 * updateMany and the post-decrement re-read operate on the live row.
 */
function fakePrisma(initialBalance: number, opts: { plan?: string; usage?: number } = {}) {
  const row = { id: "org_1", scanCredits: initialBalance, plan: opts.plan ?? "free" };
  // The hybrid allowance gate counts the month's metered scans first; default it well OVER any tier
  // allowance so these credit-debit integrity tests exercise the overflow path (where credits are spent).
  const usage = opts.usage ?? 9999;
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
    prisma: {
      // Top-level reads the allowance gate adds before the tx: the org row (plan + balance) and the
      // month's metered-scan count.
      organization: { findUnique: vi.fn(async () => ({ id: row.id, scanCredits: row.scanCredits, plan: row.plan })) },
      scan: { count: vi.fn(async () => usage) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
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

    expect(first).toEqual({ ok: true, balance: 9, unlimited: false, charged: true });
    expect(second).toEqual({ ok: true, balance: 8, unlimited: false, charged: true });
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

    expect(res).toEqual({ ok: true, balance: 5, unlimited: true, charged: false });
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

/**
 * Fake prisma that models the idempotency machinery the redelivery guarantee rides on: a unique
 * `externalId` index over the ledger. `creditLedger.findUnique({where:{externalId}})` is the fast-path
 * lookup; `creditLedger.create` rejects a duplicate externalId by throwing a Prisma `{code:"P2002"}`
 * (the unique-constraint rollback the catch swallows). The org `findUnique` is exposed at BOTH the
 * top level (used by getCreditState on the fast-path / P2002 return) and inside the tx.
 *
 * `failNextCreate` forces the NEXT create to throw P2002 regardless of seen ids — simulating the
 * concurrent-duplicate race where both callers miss the pre-check and the loser's insert is the one
 * the unique constraint rolls back.
 */
function fakePrismaForGrantIdempotent(initialBalance: number, opts: { plan?: string } = {}) {
  const row = { id: "org_1", scanCredits: initialBalance, plan: opts.plan ?? "free" };
  const ledger: Array<{ delta: number; balanceAfter: number; reason: string; externalId: string | null }> = [];
  const seenExternalIds = new Set<string>();
  const state = { failNextCreate: false };

  const findOrg = vi.fn(async () => ({ id: row.id, scanCredits: row.scanCredits, plan: row.plan }));
  const create = vi.fn(
    async ({
      data,
    }: {
      data: { delta: number; balanceAfter: number; reason: string; externalId: string | null };
    }) => {
      const dup = state.failNextCreate || (data.externalId !== null && seenExternalIds.has(data.externalId));
      if (dup) {
        state.failNextCreate = false;
        throw { code: "P2002", message: "Unique constraint failed on the fields: (`externalId`)" };
      }
      if (data.externalId !== null) seenExternalIds.add(data.externalId);
      ledger.push({
        delta: data.delta,
        balanceAfter: data.balanceAfter,
        reason: data.reason,
        externalId: data.externalId,
      });
      return data;
    },
  );

  const findLedgerByExternalId = vi.fn(async ({ where }: { where: { externalId: string } }) =>
    seenExternalIds.has(where.externalId) ? { id: `cl_${where.externalId}` } : null,
  );

  const tx = {
    organization: {
      findUnique: findOrg,
      // The grant increment is applied only when this create does NOT roll back. So the fake's update
      // bumps the balance, but a subsequent thrown create simulates the whole tx rolling back — we undo
      // it by snapshotting+restoring around the tx run below.
      update: vi.fn(async ({ data }: { data: { scanCredits: { increment: number } } }) => {
        row.scanCredits += data.scanCredits.increment;
        return { scanCredits: row.scanCredits };
      }),
    },
    creditLedger: { create },
  };

  const prisma = {
    organization: { findUnique: findOrg },
    creditLedger: { findUnique: findLedgerByExternalId },
    $transaction: async (fn: (t: typeof tx) => unknown) => {
      // Model atomic rollback: if the tx body throws, any balance increment it applied is reverted.
      const snapshot = row.scanCredits;
      try {
        return await fn(tx);
      } catch (err) {
        row.scanCredits = snapshot;
        throw err;
      }
    },
  };

  return { prisma, row, ledger, state, findLedgerByExternalId, create };
}

describe("grantCredits idempotency (webhook redelivery anti-double-grant)", () => {
  it("a genuinely new externalId grants exactly once", async () => {
    const { prisma, ledger, row } = fakePrismaForGrantIdempotent(0);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await grantCredits("acme", 100, { externalId: "ord_1", reason: "topup" });

    expect(balance).toBe(100);
    expect(row.scanCredits).toBe(100);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 100, balanceAfter: 100, externalId: "ord_1" });
  });

  it("a redelivery with the SAME externalId does not add a second ledger row or double the balance (fast-path)", async () => {
    const { prisma, ledger, row, findLedgerByExternalId, create } = fakePrismaForGrantIdempotent(0);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await grantCredits("acme", 100, { externalId: "ord_1" });
    const second = await grantCredits("acme", 100, { externalId: "ord_1" });

    // Exactly one grant landed; the redelivery short-circuited on the pre-existing externalId.
    expect(first).toBe(100);
    expect(second).toBe(100); // returns CURRENT balance, not a doubled one, and does not throw
    expect(row.scanCredits).toBe(100);
    expect(ledger).toHaveLength(1);
    expect(ledger.filter((e) => e.externalId === "ord_1")).toHaveLength(1);
    // The fast-path looked up the externalId on the redelivery and never re-attempted the insert.
    expect(findLedgerByExternalId).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: "ord_1" } }),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a concurrent duplicate that slips past the fast-path and hits a P2002 is swallowed (no throw, no double grant)", async () => {
    const { prisma, ledger, row, state } = fakePrismaForGrantIdempotent(40);
    mockGetPrisma.mockReturnValue(prisma);

    // First grant lands normally.
    const first = await grantCredits("acme", 100, { externalId: "ord_2" });
    expect(first).toBe(140);

    // Now simulate the race: a second delivery whose pre-check missed (different/raced id state) but
    // whose insert loses to the unique constraint. Force the next create to throw P2002.
    state.failNextCreate = true;
    const second = await grantCredits("acme", 100, { externalId: "ord_3" });

    // The P2002 rolled the whole tx back: balance is NOT double-incremented, no extra ledger row, and
    // the function returns the current balance instead of surfacing the error.
    expect(second).toBe(140);
    expect(row.scanCredits).toBe(140);
    expect(ledger).toHaveLength(1);
  });

  it("a P2002 is swallowed even WITHOUT a caller externalId — every grant now carries a synthesized key (retry-idempotent)", async () => {
    const { prisma, row, ledger, state } = fakePrismaForGrantIdempotent(0);
    mockGetPrisma.mockReturnValue(prisma);

    // No caller externalId (the per-scan refund case): grantCredits now synthesizes an `auto:<uuid>`
    // idempotency key, so a commit-ambiguity retry whose insert loses to the unique constraint is
    // treated as already-applied — it returns the current balance rather than appending a second
    // delta. This closes the non-idempotent refund leak (a refund under withRetry used to double).
    state.failNextCreate = true;
    const balance = await grantCredits("acme", 100, { reason: "grant" });
    expect(balance).toBe(0); // rolled back, current balance returned — no double-apply
    expect(row.scanCredits).toBe(0);
    expect(ledger).toHaveLength(0);
  });
});

/**
 * Fake prisma for the reconciliation READ path. `getCreditReconciliation` calls `getCreditLedger`,
 * which resolves the org id via `organization.findUnique`, then pulls rows via `creditLedger.findMany`.
 * We hand findMany a fixed, crafted set of rows so the classifier (positive-delta refund-vs-grant split,
 * negative-delta debited bucket) and the date window are exercised in isolation. Each row carries a real
 * `Date` createdAt so the `e.createdAt.getTime() >= cutoff` window filter runs for real.
 */
function fakePrismaForReconciliation(rows: Array<{ delta: number; reason: string; createdAt: Date }>) {
  let lastFindManyArgs: unknown = null;
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => ({ id: "org_1" })),
    },
    creditLedger: {
      findMany: vi.fn(async (args: unknown) => {
        lastFindManyArgs = args;
        // Model the DB doing the windowing: getCreditReconciliation now passes
        // `where: { createdAt: { gte: cutoff } }` (full-window aggregate, no 200-row cap), so honor
        // that filter here instead of returning every row and relying on JS-side trimming.
        const gte = (args as { where?: { createdAt?: { gte?: Date } } } | undefined)?.where?.createdAt?.gte;
        const windowed = gte ? rows.filter((r) => r.createdAt.getTime() >= gte.getTime()) : rows;
        return windowed.map((r, i) => ({
          id: `cl_${i}`,
          delta: r.delta,
          balanceAfter: 0,
          reason: r.reason,
          repoFullName: null,
          scanId: null,
          actor: null,
          createdAt: r.createdAt,
        }));
      }),
    },
  };
  return { prisma, getArgs: () => lastFindManyArgs };
}

import { getCreditReconciliation } from "./credits";

/**
 * Fake prisma for consumeScanCredit's plan-resolution + casing contract. Unlike `fakePrisma` (which
 * hard-codes a single org and ignores the `where` clause), this one:
 *  - records the `where.slug` handed to BOTH the org `findUnique` and the conditional `updateMany`, so
 *    we can assert the slug is canonicalized to lowercase before it ever reaches the query layer; and
 *  - returns `null` from `findUnique` when `org` is null, modelling a non-existent / unknown org so the
 *    deny path (`{ ok:false }`, no debit, no ledger row) is exercised — not a silent free scan.
 * The live row is mutated by `updateMany`/re-read so the metered debit-by-one is real.
 */
function fakePrismaForPlanResolution(org: { scanCredits: number; plan: string } | null, opts: { usage?: number } = {}) {
  const row = org ? { id: "org_1", scanCredits: org.scanCredits, plan: org.plan } : null;
  const usage = opts.usage ?? 9999; // default over any allowance → the credit-debit overflow path
  const ledger: Array<{ delta: number; balanceAfter: number; reason: string }> = [];
  const slugs: { findUnique: string[]; updateMany: string[] } = { findUnique: [], updateMany: [] };
  // Top-level reads the allowance gate adds before the tx (org0 + the month's metered-scan count); both
  // record the slug so the casing contract can assert every read is lowercased.
  const topFindUnique = vi.fn(async ({ where }: { where: { slug: string } }) => {
    slugs.findUnique.push(where.slug);
    return row ? { id: row.id, scanCredits: row.scanCredits, plan: row.plan } : null;
  });
  const tx = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        slugs.findUnique.push(where.slug);
        return row ? { id: row.id, scanCredits: row.scanCredits, plan: row.plan } : null;
      }),
      findUniqueOrThrow: vi.fn(async () => {
        if (!row) throw new Error("no row");
        return { scanCredits: row.scanCredits };
      }),
      updateMany: vi.fn(async ({ where }: { where: { slug: string; scanCredits: { gt: number } } }) => {
        slugs.updateMany.push(where.slug);
        if (!row || row.scanCredits <= 0) return { count: 0 };
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
    prisma: {
      organization: { findUnique: topFindUnique },
      scan: { count: vi.fn(async () => usage) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
    row,
    ledger,
    slugs,
    updateMany: tx.organization.updateMany,
  };
}

describe("consumeScanCredit plan-resolution + casing contract", () => {
  // (a) Drive the unlimited no-op off the isUnlimitedPlan CONTRACT, not the literal "enterprise":
  // for EVERY plan the contract calls unlimited, a debit must be a no-op; for a metered plan it debits.
  const unlimitedPlans = PLAN_ORDER.filter((p) => isUnlimitedPlan(p));
  const meteredPlans = PLAN_ORDER.filter((p) => !isUnlimitedPlan(p));

  it("sanity: the plan catalogue actually has both an unlimited and a metered tier to test", () => {
    expect(unlimitedPlans.length).toBeGreaterThan(0);
    expect(meteredPlans.length).toBeGreaterThan(0);
  });

  it.each(unlimitedPlans)("plan %s (isUnlimitedPlan=true) is a no-op: no debit, no ledger row", async (plan) => {
    const { prisma, ledger, row } = fakePrismaForPlanResolution({ scanCredits: 5, plan });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("acme");

    // Keyed on the plan's `unlimited` flag (data-driven from PLAN_FEATURES), never on a hardcoded string.
    expect(res).toEqual({ ok: true, balance: 5, unlimited: true, charged: false });
    expect(ledger).toHaveLength(0);
    expect(row!.scanCredits).toBe(5);
  });

  it.each(meteredPlans)("plan %s (isUnlimitedPlan=false), once OVER its allowance, decrements by exactly 1 and stamps the ledger", async (plan) => {
    const { prisma, ledger, row } = fakePrismaForPlanResolution({ scanCredits: 5, plan }); // usage default 9999 → overflow
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("acme");

    expect(res).toEqual({ ok: true, balance: 4, unlimited: false, charged: true });
    expect(row!.scanCredits).toBe(4);
    expect(ledger).toEqual([{ delta: -1, balanceAfter: 4, reason: "scan" }]);
  });

  it("a metered scan UNDER the monthly allowance is free — no debit, no ledger row", async () => {
    const { prisma, ledger, row } = fakePrismaForPlanResolution({ scanCredits: 5, plan: "pro" }, { usage: 0 }); // 0 of 100
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("acme");

    expect(res).toEqual({ ok: true, balance: 5, unlimited: false, charged: false });
    expect(row!.scanCredits).toBe(5); // untouched — covered by the allowance
    expect(ledger).toHaveLength(0);
  });

  it("canonicalizes a mixed-case slug to lowercase on BOTH the read and the conditional decrement (no double-account)", async () => {
    const { prisma, slugs } = fakePrismaForPlanResolution({ scanCredits: 5, plan: "pro" });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("ACME");

    // "ACME" must resolve the SAME org/plan as "acme" — the slug is lowercased before it hits Prisma,
    // so a mixed-case caller can't fork into a $0/free phantom org and get wrongly paywalled. Every read
    // (the allowance-gate org0 + usage count, and the tx) uses the lowercased slug.
    expect(res.ok).toBe(true);
    expect(slugs.findUnique.length).toBeGreaterThan(0);
    expect(slugs.findUnique.every((s) => s === "acme")).toBe(true);
    expect(slugs.updateMany).toEqual(["acme"]);
    expect(slugs.findUnique).not.toContain("ACME");
    expect(slugs.updateMany).not.toContain("ACME");
  });

  it("a non-existent org denies (ok:false, zero balance) — never a silent free scan", async () => {
    const { prisma, ledger, updateMany } = fakePrismaForPlanResolution(null);
    mockGetPrisma.mockReturnValue(prisma);

    const res = await consumeScanCredit("ghost");

    // Per the real code: org === null short-circuits to a denial; no decrement attempt, no ledger row.
    // orgExists:false distinguishes an UNKNOWN organization (deletion/casing/typo → caller can 404) from
    // a real out-of-credits paywall (402), instead of coalescing both into the same denied shape.
    expect(res).toEqual({ ok: false, balance: 0, unlimited: false, charged: false, orgExists: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
  });
});

describe("getCreditReconciliation refund-vs-grant classification", () => {
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);

  it("classifies a refund as refunded (NOT granted) and a grant as granted — over a mixed ledger", async () => {
    // A 30-day window: one scan debit (-1), one refund (+1), one top-up grant (+50).
    const { prisma } = fakePrismaForReconciliation([
      { delta: -1, reason: "scan", createdAt: daysAgo(1) },
      { delta: 1, reason: "refund: deduped scan", createdAt: daysAgo(2) },
      { delta: 50, reason: "grant", createdAt: daysAgo(3) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);

    // THE refund-vs-grant boundary: a +1/"refund" lands in `refunded`, the +50/"grant" in `granted`.
    // If a misclassification double-counted the refund as a fresh grant, granted would be 51 (and
    // refunded 0) — these exact-value assertions fail in that case.
    expect(rec).not.toBeNull();
    expect(rec!.refunded).toBe(1);
    expect(rec!.granted).toBe(50);
    expect(rec!.debited).toBe(1); // abs of the -1 scan spend
    // Totals reconcile: net is the sum of all deltas (-1 + 1 + 50 = 50), and a positive delta is
    // counted in EXACTLY one of refunded/granted — never both — so refunded + granted === sum of positives.
    expect(rec!.net).toBe(50);
    expect(rec!.refunded + rec!.granted).toBe(51);
    expect(rec!.entries).toBe(3);
    // debited - refunded reconciles to net credit consumption inside the window.
    expect(rec!.debited - rec!.refunded).toBe(0);
  });

  it("a refund never inflates `granted` even when several refunds and grants coexist", async () => {
    const { prisma } = fakePrismaForReconciliation([
      { delta: 2, reason: "REFUND (failed scan)", createdAt: daysAgo(1) }, // case-insensitive /refund/i
      { delta: 3, reason: "scan refund", createdAt: daysAgo(1) },
      { delta: 100, reason: "topup", createdAt: daysAgo(1) },
      { delta: 25, reason: "grant", createdAt: daysAgo(1) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);

    expect(rec!.refunded).toBe(5); // 2 + 3, matched case-insensitively
    expect(rec!.granted).toBe(125); // 100 + 25, the non-refund positives only
    expect(rec!.refunded + rec!.granted).toBe(130); // == sum of all positive deltas
    expect(rec!.net).toBe(130);
  });

  it("a negative/adjustment delta is bucketed into `debited` (abs), never into granted/refunded", async () => {
    const { prisma } = fakePrismaForReconciliation([
      { delta: -5, reason: "adjustment", createdAt: daysAgo(1) },
      { delta: -1, reason: "scan", createdAt: daysAgo(1) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);

    expect(rec!.debited).toBe(6); // |−5| + |−1|
    expect(rec!.refunded).toBe(0);
    expect(rec!.granted).toBe(0);
    expect(rec!.net).toBe(-6);
  });

  it("windows by createdAt: a row just before the cutoff is excluded; one just after is included", async () => {
    // 7-day window. One grant 6 days ago (inside) and one 8 days ago (outside the cutoff).
    const { prisma } = fakePrismaForReconciliation([
      { delta: 10, reason: "grant", createdAt: daysAgo(6) },
      { delta: 99, reason: "grant", createdAt: daysAgo(8) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 7);

    expect(rec!.entries).toBe(1); // only the in-window row survived the filter
    expect(rec!.granted).toBe(10);
    expect(rec!.net).toBe(10);
  });

  it("an empty ledger yields all zeroes and never NaN", async () => {
    const { prisma } = fakePrismaForReconciliation([]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);

    expect(rec).toEqual({ debited: 0, refunded: 0, granted: 0, net: 0, entries: 0 });
    for (const v of Object.values(rec!)) expect(Number.isNaN(v)).toBe(false);
  });

  it("returns null when persistence is off (no DB)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const rec = await getCreditReconciliation("acme", 30);
    expect(rec).toBeNull();
  });
});
