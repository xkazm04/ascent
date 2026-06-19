// Abuse-observability counters (QUOTA-6): the public funnel bumps a (kind, scope) tally fire-and-forget
// on every weekly-quota denial and rate-limit trip, read back on the /usage view. These pin the two
// invariants an operator's dashboard depends on:
//   • recordQuotaEvent upserts the RIGHT (kind, scope) key with a +1 increment — scope normalized to
//     lowercase and truncated to 60 chars so "ANON "/"anon" collapse into ONE tally, not two split rows;
//     and a thrown store write is swallowed (best-effort — it must never break the rejecting path).
//   • getQuotaEventTotals partitions rows so each event lands in exactly one bucket (quota_deny vs
//     rate_limit), aggregates `total` as the row-count sum, and returns the documented shape.
// The DB client is mocked so the import never loads Prisma; the functions run against a stubbed client.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => false),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { recordQuotaEvent, getQuotaEventTotals } from "./quota-events";

type UpsertArgs = {
  where: { kind_scope: { kind: string; scope: string } };
  update: { count: { increment: number }; lastSeen: Date };
  create: { kind: string; scope: string; count: number };
};

beforeEach(() => {
  mockIsDbConfigured.mockReset().mockReturnValue(true);
  mockGetPrisma.mockReset();
});

describe("recordQuotaEvent — fire-and-forget counter increment", () => {
  it("no-ops (no prisma access) when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    await expect(recordQuotaEvent("quota_deny", "anon")).resolves.toBeUndefined();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("each kind increments its own (kind, scope) counter by exactly 1", async () => {
    const upsert = vi.fn(async () => undefined);
    mockGetPrisma.mockReturnValue({ quotaEvent: { upsert } });

    await recordQuotaEvent("quota_deny", "anon");
    await recordQuotaEvent("rate_limit", "badge");

    expect(upsert).toHaveBeenCalledTimes(2);
    const a = upsert.mock.calls[0][0] as UpsertArgs;
    const b = upsert.mock.calls[1][0] as UpsertArgs;

    // Right bucket key, +1 increment, create-side seeds at 1 — never mis-bucketed.
    expect(a.where.kind_scope).toEqual({ kind: "quota_deny", scope: "anon" });
    expect(a.update.count).toEqual({ increment: 1 });
    expect(a.create).toMatchObject({ kind: "quota_deny", scope: "anon", count: 1 });
    expect(a.update.lastSeen).toBeInstanceOf(Date);

    expect(b.where.kind_scope).toEqual({ kind: "rate_limit", scope: "badge" });
    expect(b.update.count).toEqual({ increment: 1 });
    expect(b.create).toMatchObject({ kind: "rate_limit", scope: "badge", count: 1 });
  });

  it("canonicalizes scope (lowercased, trimmed-of-nothing-but-cased) so variants collapse to ONE key", async () => {
    const upsert = vi.fn(async () => undefined);
    mockGetPrisma.mockReturnValue({ quotaEvent: { upsert } });

    await recordQuotaEvent("quota_deny", "Anon");
    await recordQuotaEvent("quota_deny", "ANON");
    await recordQuotaEvent("quota_deny", "anon");

    const keys = upsert.mock.calls.map(
      (c) => (c[0] as UpsertArgs).where.kind_scope.scope,
    );
    // All three case variants normalize to the same tally key — no split rows.
    expect(keys).toEqual(["anon", "anon", "anon"]);
  });

  it("truncates an overlong scope to 60 chars (bounded key)", async () => {
    const upsert = vi.fn(async () => undefined);
    mockGetPrisma.mockReturnValue({ quotaEvent: { upsert } });

    const longScope = "x".repeat(200);
    await recordQuotaEvent("rate_limit", longScope);

    const args = upsert.mock.calls[0][0] as UpsertArgs;
    expect(args.where.kind_scope.scope).toHaveLength(60);
    expect(args.where.kind_scope.scope).toBe("x".repeat(60));
    expect(args.create.scope).toBe("x".repeat(60));
  });

  it("falls back to 'unknown' for an empty/falsy scope (never an empty bucket key)", async () => {
    const upsert = vi.fn(async () => undefined);
    mockGetPrisma.mockReturnValue({ quotaEvent: { upsert } });

    await recordQuotaEvent("quota_deny", "");
    await recordQuotaEvent("quota_deny", undefined as unknown as string);

    expect((upsert.mock.calls[0][0] as UpsertArgs).where.kind_scope.scope).toBe("unknown");
    expect((upsert.mock.calls[1][0] as UpsertArgs).where.kind_scope.scope).toBe("unknown");
  });

  it("swallows a thrown store write — best-effort, never rejects the calling (rejecting) path", async () => {
    const upsert = vi.fn(async () => {
      throw new Error("db exploded");
    });
    mockGetPrisma.mockReturnValue({ quotaEvent: { upsert } });

    await expect(recordQuotaEvent("rate_limit", "badge")).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("swallows a getPrisma() that itself throws (no client) without surfacing", async () => {
    mockGetPrisma.mockImplementation(() => {
      throw new Error("no client");
    });
    await expect(recordQuotaEvent("quota_deny", "anon")).resolves.toBeUndefined();
  });
});

describe("getQuotaEventTotals — partition + aggregate read shape", () => {
  it("returns null when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    await expect(getQuotaEventTotals()).resolves.toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("partitions each row into exactly one bucket and sums total as the row-count sum", async () => {
    const rows = [
      { kind: "quota_deny", scope: "anon", count: 7 },
      { kind: "rate_limit", scope: "badge", count: 5 },
      { kind: "quota_deny", scope: "signed-in", count: 3 },
      { kind: "rate_limit", scope: "import", count: 2 },
    ];
    const findMany = vi.fn(async () => rows);
    mockGetPrisma.mockReturnValue({ quotaEvent: { findMany } });

    const totals = await getQuotaEventTotals();

    expect(totals).not.toBeNull();
    // Every event lands in exactly one bucket — disjoint partition, none dropped, none double-counted.
    expect(totals!.quotaDenies).toEqual([
      { scope: "anon", count: 7 },
      { scope: "signed-in", count: 3 },
    ]);
    expect(totals!.rateLimitTrips).toEqual([
      { scope: "badge", count: 5 },
      { scope: "import", count: 2 },
    ]);
    // total = sum of EVERY row's count (7 + 5 + 3 + 2), independent of bucket.
    expect(totals!.total).toBe(17);
    // Aggregation correctness: bucket sub-sums reconcile to the grand total.
    const bucketSum =
      totals!.quotaDenies.reduce((a, r) => a + r.count, 0) +
      totals!.rateLimitTrips.reduce((a, r) => a + r.count, 0);
    expect(bucketSum).toBe(totals!.total);
  });

  it("returns empty buckets and total 0 for an empty table (documented shape, no crash)", async () => {
    const findMany = vi.fn(async () => []);
    mockGetPrisma.mockReturnValue({ quotaEvent: { findMany } });

    const totals = await getQuotaEventTotals();

    expect(totals).toEqual({ quotaDenies: [], rateLimitTrips: [], total: 0 });
  });

  it("ignores an unknown/malformed kind — it falls into neither bucket but still counts toward total", async () => {
    const rows = [
      { kind: "quota_deny", scope: "anon", count: 4 },
      { kind: "mystery_kind", scope: "weird", count: 6 }, // not a documented kind
      { kind: "rate_limit", scope: "badge", count: 1 },
    ];
    const findMany = vi.fn(async () => rows);
    mockGetPrisma.mockReturnValue({ quotaEvent: { findMany } });

    const totals = await getQuotaEventTotals();

    // The unknown kind is silently excluded from both named buckets (no crash, no mis-bucketing)...
    expect(totals!.quotaDenies).toEqual([{ scope: "anon", count: 4 }]);
    expect(totals!.rateLimitTrips).toEqual([{ scope: "badge", count: 1 }]);
    // ...yet total sums ALL rows (the read is a faithful grand tally of the table).
    expect(totals!.total).toBe(11);
  });
});
