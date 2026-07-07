// AI-usage storage behind the /delivery AI-ROI $ figures. Pins recordUsage (idempotent replace vs
// additive counter modes, malformed-row skipping, negative/NaN sanitization) and getOrgUsageRollup
// (measured-per-repo case-folded aggregation with peak seats, allocated org totals, the trailing window).
// A single in-memory aiUsageRecord store models the composite-unique upsert so writes + reads are tested
// against the same rows. The client + org-shared boundaries are mocked.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgBySlug } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgBySlug: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: mockGetOrgBySlug }));

import { recordUsage, getOrgUsageRollup, type UsageRecordInput } from "./integrations";

type Row = {
  orgId: string;
  source: string;
  scope: string;
  scopeKey: string;
  periodStart: Date;
  tokens: number;
  costCents: number;
  sessions: number;
  seats: number;
  fidelity: string;
};

/** In-memory aiUsageRecord backing the composite-unique upsert + the windowed findMany. */
function fakeUsageStore() {
  const rows: Row[] = [];
  const keyOf = (r: { orgId: string; source: string; scope: string; scopeKey: string; periodStart: Date }) =>
    [r.orgId, r.source, r.scope, r.scopeKey, r.periodStart.getTime()].join("|");
  const aiUsageRecord = {
    upsert: vi.fn(async ({ where, update, create }: { where: { orgId_source_scope_scopeKey_periodStart: Row }; update: Record<string, unknown>; create: Row }) => {
      const wk = where.orgId_source_scope_scopeKey_periodStart;
      const existing = rows.find((r) => keyOf(r) === keyOf(wk));
      if (existing) {
        for (const [field, val] of Object.entries(update)) {
          if (val && typeof val === "object" && "increment" in (val as Record<string, unknown>)) {
            (existing as Record<string, number>)[field] += (val as { increment: number }).increment;
          } else {
            (existing as Record<string, unknown>)[field] = val;
          }
        }
        return existing;
      }
      rows.push({ ...create });
      return create;
    }),
    findMany: vi.fn(async ({ where }: { where: { orgId: string; periodStart?: { gte?: Date } } }) => {
      const since = where.periodStart?.gte;
      return rows.filter((r) => r.orgId === where.orgId && (!since || r.periodStart.getTime() >= since.getTime()));
    }),
  };
  return { prisma: { aiUsageRecord }, rows };
}

const rec = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  source: "claude-code",
  scope: "repo",
  scopeKey: "acme/api",
  periodStart: new Date("2026-07-01T00:00:00Z"),
  fidelity: "measured",
  costCents: 1000,
  seats: 3,
  tokens: 500,
  sessions: 2,
  ...over,
});

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockGetOrgBySlug.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgBySlug.mockResolvedValue({ id: "org_1" });
});

describe("recordUsage", () => {
  it("returns not-ok when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await recordUsage("acme", [rec()]);
    expect(res).toEqual({ ok: false, stored: 0, error: "Database not configured." });
  });

  it("returns not-ok for an unknown org", async () => {
    mockGetOrgBySlug.mockResolvedValue(null);
    const res = await recordUsage("ghost", [rec()]);
    expect(res).toEqual({ ok: false, stored: 0, error: "Unknown organization." });
  });

  it("stores valid records and SKIPS malformed ones (missing key, bad date, bad fidelity)", async () => {
    const { prisma, rows } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    const res = await recordUsage("acme", [
      rec(),
      rec({ scopeKey: "" }), // missing key → skip
      rec({ periodStart: new Date("nope") }), // NaN date → skip
      rec({ fidelity: "bogus" as UsageRecordInput["fidelity"] }), // bad fidelity → skip
      rec({ scopeKey: "acme/web" }), // valid
    ]);

    expect(res).toEqual({ ok: true, stored: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.scopeKey).sort()).toEqual(["acme/api", "acme/web"]);
  });

  it('"replace" mode (default) is idempotent — re-posting a period SETS, never doubles', async () => {
    const { prisma, rows } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    await recordUsage("acme", [rec({ costCents: 1000 })]);
    await recordUsage("acme", [rec({ costCents: 1000 })]); // same composite key

    expect(rows).toHaveLength(1);
    expect(rows[0]!.costCents).toBe(1000); // replaced, not 2000
  });

  it('"add" mode increments counters but REPLACES seats (a level, not additive)', async () => {
    const { prisma, rows } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    await recordUsage("acme", [rec({ costCents: 1000, tokens: 500, sessions: 2, seats: 5 })], { mode: "add" });
    await recordUsage("acme", [rec({ costCents: 250, tokens: 100, sessions: 1, seats: 3 })], { mode: "add" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ costCents: 1250, tokens: 600, sessions: 3, seats: 3 });
  });

  it("sanitizes negative / NaN / non-number fields to 0 and rounds floats", async () => {
    const { prisma, rows } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    await recordUsage("acme", [rec({ costCents: -5, tokens: 3.7, sessions: Number.NaN, seats: "x" as unknown as number })]);

    expect(rows[0]).toMatchObject({ costCents: 0, tokens: 4, sessions: 0, seats: 0 });
  });
});

describe("getOrgUsageRollup", () => {
  it("returns null when the DB is off or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgUsageRollup("acme")).toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgBySlug.mockResolvedValue(null);
    expect(await getOrgUsageRollup("ghost")).toBeNull();
  });

  it("returns an empty-but-present rollup when the org has no records", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);
    const rollup = await getOrgUsageRollup("acme");
    expect(rollup).toEqual({ hasMeasured: false, hasAllocated: false, perRepo: {}, orgTotals: [], sources: [] });
  });

  it("aggregates measured per-repo usage case-folded, summing cost/tokens and taking PEAK seats", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    // Two day-buckets for the same repo (different case) → one lower-cased perRepo entry.
    await recordUsage("acme", [
      rec({ scopeKey: "Acme/API", periodStart: new Date("2026-07-01T00:00:00Z"), costCents: 1000, tokens: 500, seats: 5 }),
      rec({ scopeKey: "acme/api", periodStart: new Date("2026-07-02T00:00:00Z"), costCents: 400, tokens: 200, seats: 3 }),
    ]);

    const rollup = await getOrgUsageRollup("acme");
    expect(rollup!.hasMeasured).toBe(true);
    expect(rollup!.perRepo["acme/api"]).toEqual({ costCents: 1400, tokens: 700, seats: 5, source: "claude-code" });
    expect(Object.keys(rollup!.perRepo)).toEqual(["acme/api"]);
  });

  it("aggregates allocated org-level totals per source", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    await recordUsage("acme", [
      rec({ scope: "org", scopeKey: "acme", source: "copilot", fidelity: "allocated", costCents: 2000, seats: 10, tokens: 0 }),
    ]);

    const rollup = await getOrgUsageRollup("acme");
    expect(rollup!.hasAllocated).toBe(true);
    expect(rollup!.orgTotals).toEqual([{ source: "copilot", costCents: 2000, seats: 10, tokens: 0 }]);
    expect(rollup!.sources).toContain("copilot");
  });

  it("excludes records older than the trailing window", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    const old = new Date(Date.now() - 60 * 86_400_000);
    const recent = new Date(Date.now() - 2 * 86_400_000);
    await recordUsage("acme", [
      rec({ scopeKey: "acme/old", periodStart: old, costCents: 999 }),
      rec({ scopeKey: "acme/new", periodStart: recent, costCents: 111 }),
    ]);

    const rollup = await getOrgUsageRollup("acme", 35);
    expect(Object.keys(rollup!.perRepo)).toEqual(["acme/new"]);
  });
});
