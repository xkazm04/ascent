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
  // credits.ts's isDuplicateExternalId now delegates to the general isP2002Error (db/client.ts) —
  // reimplement its real (duck-typed, non-instanceof) semantics here since this mock replaces the
  // whole module.
  isP2002Error: (err: unknown) =>
    typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002",
}));

import { clawbackOrderRefund, consumeScanCredit, grantCredits } from "./credits";
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

import { getCreditReconciliation, CREDIT_REASON, isRefundReason } from "./credits";

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
      { delta: -1, reason: CREDIT_REASON.SCAN, createdAt: daysAgo(1) },
      { delta: 1, reason: CREDIT_REASON.REFUND, createdAt: daysAgo(2) },
      { delta: 50, reason: CREDIT_REASON.GRANT, createdAt: daysAgo(3) },
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
    // Refund rows carry the canonical CREDIT_REASON.REFUND the producers actually write; everything
    // else is a grant. Classification is now an EXACT match on that constant (not a free-text /refund/i
    // substring), so a non-refund positive can never leak into `refunded` and vice-versa.
    const { prisma } = fakePrismaForReconciliation([
      { delta: 2, reason: CREDIT_REASON.REFUND, createdAt: daysAgo(1) },
      { delta: 3, reason: CREDIT_REASON.REFUND, createdAt: daysAgo(1) },
      { delta: 100, reason: "topup", createdAt: daysAgo(1) },
      { delta: 25, reason: CREDIT_REASON.GRANT, createdAt: daysAgo(1) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);

    expect(rec!.refunded).toBe(5); // 2 + 3, the canonical-refund positives only
    expect(rec!.granted).toBe(125); // 100 + 25, the non-refund positives only
    expect(rec!.refunded + rec!.granted).toBe(130); // == sum of all positive deltas
    expect(rec!.net).toBe(130);
  });

  it("classifies by the shared CREDIT_REASON.REFUND constant, NOT a substring (producer↔reader contract)", async () => {
    // The refund WRITERS stamp exactly CREDIT_REASON.REFUND, so the reader must accept that and reject
    // look-alikes: a refund mistakenly stamped "dedup"/"scan refund" must NOT be silently counted, and
    // a non-refund reason that merely contains the word must NOT land in `refunded`.
    expect(isRefundReason(CREDIT_REASON.REFUND)).toBe(true);
    expect(isRefundReason("REFUND")).toBe(true); // trim/case-tolerant
    expect(isRefundReason("scan refund")).toBe(false); // substring no longer matches
    expect(isRefundReason("dedup")).toBe(false);
    expect(isRefundReason(CREDIT_REASON.POLAR_REFUND)).toBe(false);

    const { prisma } = fakePrismaForReconciliation([
      { delta: 4, reason: CREDIT_REASON.REFUND, createdAt: daysAgo(1) }, // a real refund → refunded
      { delta: 7, reason: "reverted", createdAt: daysAgo(1) }, // a non-canonical positive → granted
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const rec = await getCreditReconciliation("acme", 30);
    expect(rec!.refunded).toBe(4);
    expect(rec!.granted).toBe(7);
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

/**
 * Fake prisma for clawbackOrderRefund — the refund-abuse defense. Models the two pieces its correctness
 * rides on: (a) a unique `externalId` per refund EVENT (`polar-refund:<orderId>:<cumulativeAmount>`) so a
 * redelivery collapses, and (b) an `aggregate` over the order's prior `polar-refund` rows so a 2nd+ partial
 * only reverses the MARGINAL share. The live org row is shared mutable state; `update` applies the relative
 * increment; `$transaction` rolls the balance back if the body throws (P2002 from a duplicate create).
 */
function fakePrismaForClawback(
  initialBalance: number,
  opts: { org?: boolean; seed?: Array<{ delta: number; externalId: string }> } = {},
) {
  const present = opts.org ?? true;
  const row = present ? { id: "org_1", scanCredits: initialBalance, plan: "pro" } : null;
  const ledger: Array<{ delta: number; balanceAfter: number; reason: string; externalId: string }> = [];
  const seen = new Set<string>();
  // Pre-existing clawback rows ALREADY on the ledger before this test runs — e.g. a legacy no-colon
  // per-order row (`polar-refund:<orderId>`) written by the pre-migration code. Seeded straight into the
  // ledger and deliberately NOT into `seen`, so a NEW-format event for the same order still clears the
  // per-event fast-path and reaches the aggregate — exactly the cross-migration path the bug lived on.
  for (const s of opts.seed ?? []) {
    ledger.push({ delta: s.delta, balanceAfter: 0, reason: "polar-refund", externalId: s.externalId });
  }

  const findSeen = vi.fn(async ({ where }: { where: { externalId: string } }) =>
    seen.has(where.externalId) ? { id: `cl_${where.externalId}` } : null,
  );
  const tx = {
    organization: {
      findUnique: vi.fn(async () => (row ? { id: row.id, scanCredits: row.scanCredits } : null)),
      update: vi.fn(async ({ data }: { data: { scanCredits: { increment: number } } }) => {
        row!.scanCredits += data.scanCredits.increment;
        return { scanCredits: row!.scanCredits };
      }),
    },
    creditLedger: {
      // Sum |delta| already clawed for THIS order. The real code passes an OR of the exact legacy key
      // (`polar-refund:<orderId>`) and the per-event startsWith prefix (`polar-refund:<orderId>:`), so a
      // row counts when it satisfies ANY branch — the same tolerant matcher sumRefundClawback uses. (The
      // prior mock read a single `externalId.startsWith`; that shape no longer reaches this aggregate.)
      aggregate: vi.fn(async ({ where }: { where: { OR: Array<{ externalId: string | { startsWith: string } }> } }) => {
        const matches = (eid: string) =>
          where.OR.some((b) =>
            typeof b.externalId === "string" ? b.externalId === eid : eid.startsWith(b.externalId.startsWith),
          );
        const total = ledger.filter((e) => matches(e.externalId)).reduce((a, e) => a + e.delta, 0);
        return { _sum: { delta: total } };
      }),
      create: vi.fn(
        async ({ data }: { data: { delta: number; balanceAfter: number; reason: string; externalId: string } }) => {
          if (seen.has(data.externalId)) throw { code: "P2002", message: "Unique constraint failed (externalId)" };
          seen.add(data.externalId);
          ledger.push({ delta: data.delta, balanceAfter: data.balanceAfter, reason: data.reason, externalId: data.externalId });
          return data;
        },
      ),
    },
  };
  const prisma = {
    organization: { findUnique: vi.fn(async () => (row ? { scanCredits: row.scanCredits, plan: row.plan } : null)) },
    creditLedger: { findUnique: findSeen },
    $transaction: async (fn: (t: typeof tx) => unknown) => {
      const snap = row ? row.scanCredits : 0;
      try {
        return await fn(tx);
      } catch (err) {
        if (row) row.scanCredits = snap;
        throw err;
      }
    },
  };
  return { prisma, row, ledger };
}

describe("clawbackOrderRefund (Polar refund-abuse defense)", () => {
  it("a full refund reverses the whole granted pack", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await clawbackOrderRefund("acme", "ord1", 100, { eventKey: "1000" });

    expect(balance).toBe(0);
    expect(row!.scanCredits).toBe(0);
    expect(ledger).toEqual([
      { delta: -100, balanceAfter: 0, reason: "polar-refund", externalId: "polar-refund:ord1:1000" },
    ]);
  });

  it("a partial refund reverses only its proportional share", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" });

    expect(balance).toBe(60);
    expect(row!.scanCredits).toBe(60);
    expect(ledger).toEqual([{ delta: -40, balanceAfter: 60, reason: "polar-refund", externalId: "polar-refund:ord1:400" }]);
  });

  it("sequential partials apply only the MARGINAL share (cumulative target, not double-clawing)", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" }); // → -40, balance 60
    const balance = await clawbackOrderRefund("acme", "ord1", 70, { eventKey: "700" }); // cumulative target 70 → marginal 30

    expect(balance).toBe(30);
    expect(row!.scanCredits).toBe(30);
    expect(ledger.map((e) => e.delta)).toEqual([-40, -30]);
  });

  it("partial-then-full reconciles to the full pack (marginal 60 after a first -40)", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" });
    const balance = await clawbackOrderRefund("acme", "ord1", 100, { eventKey: "1000" });

    expect(balance).toBe(0);
    expect(row!.scanCredits).toBe(0);
    expect(ledger.map((e) => e.delta)).toEqual([-40, -60]);
  });

  it("a redelivery of the SAME refund event is a no-op (fast-path on the per-event externalId)", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    const first = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" });
    const second = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" }); // same event redelivered

    expect(first).toBe(60);
    expect(second).toBe(60); // current balance, not double-clawed
    expect(row!.scanCredits).toBe(60);
    expect(ledger).toHaveLength(1);
  });

  it("clamps at zero when the balance was already spent (an already-spent pack absorbs the rest)", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(10); // bought 100, spent 90
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await clawbackOrderRefund("acme", "ord1", 100, { eventKey: "1000" });

    expect(balance).toBe(0); // never negative
    expect(row!.scanCredits).toBe(0);
    expect(ledger).toEqual([{ delta: -10, balanceAfter: 0, reason: "polar-refund", externalId: "polar-refund:ord1:1000" }]);
  });

  it("a cumulative target no greater than what's already clawed adds nothing (marginal ≤ 0)", async () => {
    const { prisma, row, ledger } = fakePrismaForClawback(100);
    mockGetPrisma.mockReturnValue(prisma);

    await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" }); // -40
    const balance = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400b" }); // same target, new event

    expect(balance).toBe(60);
    expect(row!.scanCredits).toBe(60);
    expect(ledger).toHaveLength(1); // no second row
  });

  it("returns null for an unknown org (no clawback attempted)", async () => {
    const { prisma, ledger } = fakePrismaForClawback(0, { org: false });
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await clawbackOrderRefund("ghost", "ord1", 40, { eventKey: "400" });

    expect(balance).toBeNull();
    expect(ledger).toHaveLength(0);
  });

  // THE cross-migration double-claw bug (finding #1): an order clawed under the OLD code left a LEGACY
  // no-colon key `polar-refund:<orderId>`. After the deploy, clawbackOrderRefund's `prior` aggregate must
  // still SEE that row, or `alreadyClawed` under-counts and the already-reversed share is clawed twice —
  // silently deleting paid credits. These pin that the aggregate is tolerant of BOTH key formats.
  it("does NOT re-claw a legacy no-colon row for the same cumulative amount (cross-format idempotency)", async () => {
    // 100-credit pack; the pre-migration code already partially refunded 40 → legacy row, balance 60.
    const { prisma, row, ledger } = fakePrismaForClawback(60, {
      seed: [{ delta: -40, externalId: "polar-refund:ord1" }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    // A NEW-format event re-processes the SAME cumulative 40. alreadyClawed must count the legacy -40, so
    // marginal = 40 − 40 = 0 → nothing new. If the aggregate missed the legacy row, marginal would be 40
    // and the balance would drop to 20 — a second, spurious claw of already-refunded credits.
    const balance = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" });

    expect(balance).toBe(60); // unchanged — the refund already accounted for by the legacy row
    expect(row!.scanCredits).toBe(60);
    expect(ledger).toHaveLength(1); // only the seeded legacy row; no second clawback appended
  });

  it("applies only the MARGINAL share over a legacy no-colon row (larger refund straddling the migration)", async () => {
    // Same setup: legacy -40 already clawed, balance 60. A later, LARGER cumulative refund (70) arrives
    // under the new code.
    const { prisma, row, ledger } = fakePrismaForClawback(60, {
      seed: [{ delta: -40, externalId: "polar-refund:ord1" }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const balance = await clawbackOrderRefund("acme", "ord1", 70, { eventKey: "700" });

    // alreadyClawed = 40 (legacy) → marginal = 30, balance 60 → 30, one new per-event row. Missing the
    // legacy row would make marginal 70 → appliedDelta clamped to −60 → balance 0 (30 credits destroyed).
    expect(balance).toBe(30);
    expect(row!.scanCredits).toBe(30);
    expect(ledger.map((e) => e.delta)).toEqual([-40, -30]);
    expect(ledger[1].externalId).toBe("polar-refund:ord1:700");
  });

  it("returns null when persistence is off (no DB)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const balance = await clawbackOrderRefund("acme", "ord1", 40, { eventKey: "400" });
    expect(balance).toBeNull();
  });
});
