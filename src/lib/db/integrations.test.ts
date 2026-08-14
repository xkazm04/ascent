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

import {
  recordUsage,
  getOrgUsageRollup,
  getProviderIngestStatus,
  getIngestTokenEpoch,
  bumpIngestTokenEpoch,
  type UsageRecordInput,
} from "./integrations";

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

/**
 * Day-buckets RELATIVE TO NOW. `getOrgUsageRollup` reads a TRAILING 35-day window, so a fixture
 * pinned to a fixed calendar date is a time bomb: it sits inside the window when written and
 * silently ages out of it, at which point every "aggregates …" assertion fails with an empty rollup
 * and looks like a regression in code that never changed. That is exactly what happened to the two
 * tests below. Express fixture ages in DAYS AGO — the way the window-exclusion test below always did.
 */
const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

const rec = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  source: "claude-code",
  scope: "repo",
  scopeKey: "acme/api",
  periodStart: daysAgo(3),
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
    expect(rollup).toEqual({ hasMeasured: false, hasAllocated: false, hasAllocatedCost: false, perRepo: {}, orgTotals: [], sources: [] });
  });

  it("aggregates measured per-repo usage case-folded, summing cost/tokens and taking PEAK seats", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);

    // Two day-buckets for the same repo (different case) → one lower-cased perRepo entry.
    await recordUsage("acme", [
      rec({ scopeKey: "Acme/API", periodStart: daysAgo(4), costCents: 1000, tokens: 500, seats: 5 }),
      rec({ scopeKey: "acme/api", periodStart: daysAgo(3), costCents: 400, tokens: 200, seats: 3 }),
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

    const old = daysAgo(60);
    const recent = daysAgo(2);
    await recordUsage("acme", [
      rec({ scopeKey: "acme/old", periodStart: old, costCents: 999 }),
      rec({ scopeKey: "acme/new", periodStart: recent, costCents: 111 }),
    ]);

    const rollup = await getOrgUsageRollup("acme", 35);
    expect(Object.keys(rollup!.perRepo)).toEqual(["acme/new"]);
  });
});

describe("getProviderIngestStatus — what each provider actually landed", () => {
  const t = (iso: string) => new Date(iso);
  /** Rows keyed by updatedAt (the Prisma @updatedAt the ingest path already maintains). */
  function statusStore(rows: Record<string, unknown>[]) {
    mockGetPrisma.mockReturnValue({
      aiUsageRecord: {
        findMany: vi.fn(async ({ where }: { where: { orgId: string; updatedAt?: { gte?: Date } } }) => {
          const since = where.updatedAt?.gte;
          return rows.filter((r) => r.orgId === where.orgId && (!since || (r.updatedAt as Date) >= since));
        }),
      },
    });
  }
  const row = (over: Record<string, unknown> = {}) => ({
    orgId: "org_1",
    source: "claude-code",
    scope: "repo",
    scopeKey: "acme/api",
    fidelity: "measured",
    costCents: 100,
    tokens: 10,
    updatedAt: t("2026-07-20T10:00:00Z"),
    ...over,
  });

  it("returns null when the DB is off or the org is unknown (the page says nothing, not 'never received')", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getProviderIngestStatus("acme")).toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgBySlug.mockResolvedValue(null);
    expect(await getProviderIngestStatus("ghost")).toBeNull();
  });

  it("reports the newest updatedAt as last-received, with distinct repos and summed cost", async () => {
    statusStore([
      row({ updatedAt: t("2026-07-20T10:00:00Z"), scopeKey: "acme/api", costCents: 100, tokens: 10 }),
      row({ updatedAt: t("2026-07-22T09:00:00Z"), scopeKey: "acme/web", costCents: 250, tokens: 40 }),
      row({ updatedAt: t("2026-07-21T09:00:00Z"), scopeKey: "ACME/api", costCents: 50, tokens: 5 }), // case-folded dup
    ]);
    const [s] = (await getProviderIngestStatus("acme"))!;
    expect(s!.lastReceived.toISOString()).toBe("2026-07-22T09:00:00.000Z");
    expect(s!.repos).toBe(2);
    expect(s!.costCents).toBe(400);
    expect(s!.tokens).toBe(55);
    expect(s!.measured).toBe(true);
  });

  it("reports repos: 0 when telemetry arrived but nothing was attributed to a repo (the silent-drop case)", async () => {
    statusStore([row({ scope: "org", scopeKey: "acme", fidelity: "allocated" })]);
    const [s] = (await getProviderIngestStatus("acme"))!;
    expect(s!.repos).toBe(0);
    expect(s!.measured).toBe(false);
    expect(s!.lastReceived).toBeInstanceOf(Date);
  });

  it("splits by source, so one connected provider never masks another's silence", async () => {
    statusStore([row(), row({ source: "copilot", scope: "org", scopeKey: "acme", fidelity: "allocated" })]);
    const all = (await getProviderIngestStatus("acme"))!;
    expect(all.map((s) => s.source).sort()).toEqual(["claude-code", "copilot"]);
  });

  it("returns an empty list when the org exists but has never received anything", async () => {
    statusStore([]);
    expect(await getProviderIngestStatus("acme")).toEqual([]);
  });
});

describe("ingest token epoch", () => {
  it("reads 0 for a never-rotated org and for a DB-less deployment", async () => {
    mockGetOrgBySlug.mockResolvedValue({ id: "org_1", ingestTokenEpoch: 0 });
    expect(await getIngestTokenEpoch("acme")).toBe(0);
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getIngestTokenEpoch("acme")).toBe(0);
  });

  it("reads the stored epoch, and 0 for an unknown org", async () => {
    mockGetOrgBySlug.mockResolvedValue({ id: "org_1", ingestTokenEpoch: 7 });
    expect(await getIngestTokenEpoch("acme")).toBe(7);
    mockGetOrgBySlug.mockResolvedValue(null);
    expect(await getIngestTokenEpoch("ghost")).toBe(0);
  });

  it("returns null (NOT 0) when the lookup fails — 'unknown' must never read as 'never rotated'", async () => {
    mockGetOrgBySlug.mockRejectedValue(new Error("connection lost"));
    expect(await getIngestTokenEpoch("acme")).toBeNull();
  });

  it("bumps by one and returns the new epoch", async () => {
    mockGetOrgBySlug.mockResolvedValue({ id: "org_1", ingestTokenEpoch: 2 });
    const update = vi.fn(async () => ({ ingestTokenEpoch: 3 }));
    mockGetPrisma.mockReturnValue({ organization: { update } });
    expect(await bumpIngestTokenEpoch("acme")).toBe(3);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { ingestTokenEpoch: { increment: 1 } } }));
  });

  it("refuses to report a bump that cannot be persisted (no DB / unknown org)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await bumpIngestTokenEpoch("acme")).toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgBySlug.mockResolvedValue(null);
    expect(await bumpIngestTokenEpoch("ghost")).toBeNull();
  });
});

// W3b — `hasAllocated` and `hasAllocatedCost` are deliberately different facts. The Copilot
// connector stores real org-level records whose costCents is 0 because GitHub does not expose a
// per-seat price; treating those as a cost source would divide a zero total across every repo and
// render the whole fleet as "$0 spend / shadow AI".
describe("getOrgUsageRollup — allocated records vs allocated COST", () => {
  it("flags a cost-bearing org record as both allocated and allocated-cost", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);
    await recordUsage("acme", [rec({ scope: "org", scopeKey: "acme", fidelity: "allocated", costCents: 2000 })]);
    const r = await getOrgUsageRollup("acme");
    expect(r).toMatchObject({ hasAllocated: true, hasAllocatedCost: true });
  });

  it("flags a SEATS-ONLY org record as allocated but NOT a cost source", async () => {
    const { prisma } = fakeUsageStore();
    mockGetPrisma.mockReturnValue(prisma);
    await recordUsage("acme", [
      rec({ source: "copilot", scope: "org", scopeKey: "acme", fidelity: "allocated", costCents: 0, tokens: 0, seats: 40 }),
    ]);
    const r = await getOrgUsageRollup("acme");
    expect(r).toMatchObject({ hasAllocated: true, hasAllocatedCost: false });
    // The seats are real and must still be reported — the connector is not useless, it just isn't money.
    expect(r!.orgTotals).toEqual([{ source: "copilot", costCents: 0, seats: 40, tokens: 0 }]);
  });
});
