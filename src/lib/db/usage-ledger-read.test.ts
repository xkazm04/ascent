// The calls drill-in read. Prisma is mocked; the query shapes are what is pinned: the filtered read
// runs over the SAME half-open window the panel totals use, most expensive first with unpriced last,
// capped at 50, and the unpriced half comes back as groups that sum to the filter's unpriced count.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured, mockGetOrgId } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
  mockGetOrgId: vi.fn(async (slug: string) => (slug === "acme" ? "org_acme" : null)),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { LEDGER_CALLS_LIMIT, listLedgerCalls } from "@/lib/db/usage-ledger-read";

type Args = Record<string, unknown>;
const since = new Date("2026-09-23T00:00:00.000Z");
const before = new Date("2026-10-23T00:00:00.000Z");

function fake(opts: { rows?: Args[]; count?: number; unpriced?: Args[]; silent?: Args[] } = {}) {
  const calls = { findMany: [] as Args[], count: [] as Args[], groupBy: [] as Args[] };
  const usageEvent = {
    findMany: vi.fn(async (a: Args) => (calls.findMany.push(a), opts.rows ?? [])),
    count: vi.fn(async (a: Args) => (calls.count.push(a), opts.count ?? 0)),
    groupBy: vi.fn(async (a: Args) => {
      calls.groupBy.push(a);
      return "AND" in (a.where as Args) ? (opts.silent ?? []) : (opts.unpriced ?? []);
    }),
  };
  mockGetPrisma.mockReturnValue({ usageEvent });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("listLedgerCalls", () => {
  it("queries a team filter over the panel's window, priciest first, unpriced last, take <= 50", async () => {
    const q = fake();
    await listLedgerCalls("acme", { kind: "team", teamKey: "@o/a" }, since, before);
    const args = q.findMany[0]!;
    expect(args.where).toEqual({ orgId: "org_acme", teamKey: "@o/a", createdAt: { gte: since, lt: before } });
    expect(args.orderBy).toEqual([{ costMicros: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]);
    expect(args.take).toBe(LEDGER_CALLS_LIMIT);
    expect(LEDGER_CALLS_LIMIT).toBeLessThanOrEqual(50);
    expect(q.count[0]!.where).toEqual(args.where);
  });

  it("maps lane, repo, cell and unpriced filters onto their indexed columns", async () => {
    const q = fake();
    await listLedgerCalls("acme", { kind: "lane", lane: "athena" }, since, before);
    await listLedgerCalls("acme", { kind: "repo", repoFullName: null }, since, before);
    await listLedgerCalls("acme", { kind: "cell", lane: "local", teamKey: null }, since, before);
    await listLedgerCalls("acme", { kind: "unpriced" }, since, before);
    expect(q.findMany.map((a) => a.where)).toEqual([
      { orgId: "org_acme", lane: "athena", createdAt: { gte: since, lt: before } },
      { orgId: "org_acme", repoFullName: null, createdAt: { gte: since, lt: before } },
      { orgId: "org_acme", lane: "local", teamKey: null, createdAt: { gte: since, lt: before } },
      { orgId: "org_acme", costMicros: null, createdAt: { gte: since, lt: before } },
    ]);
  });

  it("splits each unpriced group into its silent and token-reporting halves", async () => {
    fake({
      count: 50,
      unpriced: [
        { provider: "anthropic", model: "claude-sonnet-4", byom: true, _count: { _all: 38 } },
        { provider: "openrouter", model: "mystery-1", byom: null, _count: { _all: 9 } },
      ],
      silent: [{ provider: "openrouter", model: "mystery-1", byom: null, _count: { _all: 2 } }],
    });
    const out = await listLedgerCalls("acme", { kind: "lane", lane: "athena" }, since, before);
    expect(out.calls).toBe(50);
    expect(out.unpricedGroups).toEqual([
      { provider: "anthropic", model: "claude-sonnet-4", byom: true, tokensReported: true, calls: 38 },
      { provider: "openrouter", model: "mystery-1", byom: null, tokensReported: false, calls: 2 },
      { provider: "openrouter", model: "mystery-1", byom: null, tokensReported: true, calls: 7 },
    ]);
    expect(out.unpricedGroups.reduce((a, g) => a + g.calls, 0)).toBe(47);
  });

  it("ships createdAt as an ISO string", async () => {
    fake({ rows: [{ id: "e1", lane: "athena", provider: "anthropic", model: "m", status: "success", costMicros: 5, createdAt: since }] });
    const out = await listLedgerCalls("acme", { kind: "unpriced" }, since, before);
    expect(out.rows[0]!.createdAt).toBe(since.toISOString());
  });

  it("reads nothing when persistence is off or the org is unknown", async () => {
    const q = fake();
    mockIsDbConfigured.mockReturnValue(false);
    expect((await listLedgerCalls("acme", { kind: "unpriced" }, since, before)).rows).toEqual([]);
    mockIsDbConfigured.mockReturnValue(true);
    expect((await listLedgerCalls("nope", { kind: "unpriced" }, since, before)).rows).toEqual([]);
    expect(q.findMany).toHaveLength(0);
  });
});
