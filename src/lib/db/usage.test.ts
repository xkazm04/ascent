// Billing-aggregation invariants: the cost estimate must never silently bill at $0 when a rate is
// unset (the half-billing trap), the per-day series must bucket by UTC day with a billable/free
// split on a stable axis, and every "metered/billable" aggregate (headline tile, trend series, top
// repos) must share ONE predicate — private AND Ascent-metered (not mock, not BYOM) — over ONE
// window. The DB client is mocked so the import never loads Prisma; getUsageSummary runs against a
// stubbed client.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => false),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import {
  boundUsageDays,
  buildDailySeries,
  estimateLlmCostFromTable,
  estimateLlmCostUsd,
  foldLaneCost,
  getUsageSummary,
  clampDailySeries,
  isBillableScan,
  unpricedScanCalls,
  mergeRepoUsage,
  usageWindow,
  type RepoUsage,
  type UsageDay,
} from "./usage";

describe("foldLaneCost", () => {
  const lane = (o: Partial<import("./usage-events").LaneUsage>) =>
    ({ lane: "athena", calls: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: null, unpricedCalls: 0, ...o }) as import("./usage-events").LaneUsage;

  it("adds the priced lanes together — the headline equals the lane table's sum", () => {
    const f = foldLaneCost([lane({ lane: "scan", calls: 43, estimatedCostUsd: 25.89913 }), lane({ lane: "local", calls: 53, estimatedCostUsd: 89.377523, unpricedCalls: 34 })]);
    expect(f.allLanesCostUsd).toBeCloseTo(115.276653, 6);
  });

  it("carries the unpriced count up so the headline reads as a FLOOR, never a total", () => {
    const f = foldLaneCost([lane({ lane: "scan", calls: 43, estimatedCostUsd: 25.89913 }), lane({ lane: "local", calls: 53, estimatedCostUsd: 89.38, unpricedCalls: 34 })]);
    expect(f.allLanesUnpricedCalls).toBe(34);
  });

  it("never folds an unpriceable lane in as $0 — it stays null volume, counted", () => {
    const f = foldLaneCost([lane({ lane: "memory", calls: 5, estimatedCostUsd: null, unpricedCalls: 5 })]);
    expect(f.allLanesCostUsd).toBeNull();
    expect(f.allLanesUnpricedCalls).toBe(5);
  });

  it("is null (not 0) for an empty period, so the tile shows an em dash rather than a free month", () => {
    expect(foldLaneCost([])).toEqual({ allLanesCostUsd: null, allLanesUnpricedCalls: 0 });
  });
});

describe("estimateLlmCostUsd", () => {
  it("returns null unless BOTH per-MTok rates are set", () => {
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, undefined, "2")).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "1", undefined)).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "1", "")).toBeNull();
  });

  it("computes per-MTok cost across input and output", () => {
    expect(estimateLlmCostUsd(2_000_000, 1_000_000, "0.30", "2.50")).toBeCloseTo(0.6 + 2.5, 6);
  });

  it("treats an explicit 0 as a real price, not 'unset'", () => {
    expect(estimateLlmCostUsd(5_000_000, 5_000_000, "0", "0")).toBe(0);
  });

  it("rejects negative or non-numeric rates as unset", () => {
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "-1", "2")).toBeNull();
    expect(estimateLlmCostUsd(1_000_000, 1_000_000, "abc", "2")).toBeNull();
  });
});

describe("estimateLlmCostFromTable (built-in per-model basis, llm 06-11 #2)", () => {
  it("prices a mixed-provider fleet per model, not at one global rate", () => {
    // 1M in + 1M out on Gemini 3 Flash ($0.50 + $3.00) and on Sonnet 4.6 via Bedrock ($3 + $15).
    const cost = estimateLlmCostFromTable([
      { model: "gemini-3-flash-preview", inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { model: "us.anthropic.claude-sonnet-4-6", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ]);
    expect(cost).toBeCloseTo(0.5 + 3 + 3 + 15, 6);
  });

  it("returns null when ANY token-bearing model is unpriceable (no partial half-bill)", () => {
    expect(
      estimateLlmCostFromTable([
        { model: "gemini-3-flash-preview", inputTokens: 1_000_000, outputTokens: 0 },
        { model: "local-llama", inputTokens: 5, outputTokens: 5 },
      ]),
    ).toBeNull();
  });

  it("ignores token-less rows (mock) and returns null when nothing consumed tokens", () => {
    expect(
      estimateLlmCostFromTable([
        { model: "mock", inputTokens: 0, outputTokens: 0 },
        { model: "gemini-3-flash-preview", inputTokens: 2_000_000, outputTokens: 0 },
      ]),
    ).toBeCloseTo(1.0, 6);
    expect(estimateLlmCostFromTable([{ model: "mock", inputTokens: 0, outputTokens: 0 }])).toBeNull();
    expect(estimateLlmCostFromTable([])).toBeNull();
  });
});

// ── ONE pass over the period, folded three ways, and the money half of the repo attribution ─────
//
// The window used to be grouped THREE times over the identical `periodWhere` — (provider, model,
// byom) for the cost basis, (repoId) for the top-repos panel, (repoId, provider, model, byom) for the
// team split — and the third was a superset of the other two; the window's repos were then read from
// `Repository` TWICE (names for the panel, default owners for the split). One groupBy and one
// findMany now feed all three folds, and the billable scoping the SQL `where` used to do moved into
// JS against the same predicate (`isBillableScan`) every other aggregate on the page uses.
function summaryPrisma(opts: {
  scanGroups?: Record<string, unknown>[];
  repos?: Record<string, unknown>[];
  eventRepos?: Record<string, unknown>[];
}) {
  const calls = { scanGroupBy: [] as Record<string, unknown>[], repoFindMany: [] as unknown[] };
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({
    organization: { findUnique: vi.fn(async () => ({ id: "org1", slug: "acme", kind: "org" })) },
    scan: {
      count: vi.fn(async () => 3),
      groupBy: vi.fn(async (args: { by: string[] }) => {
        calls.scanGroupBy.push(args as unknown as Record<string, unknown>);
        return args.by.includes("repoId") ? (opts.scanGroups ?? []) : [];
      }),
      aggregate: vi.fn(async () => ({ _min: { scannedAt: null }, _max: { scannedAt: null } })),
    },
    repository: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async (args: unknown) => {
        calls.repoFindMany.push(args);
        return opts.repos ?? [];
      }),
    },
    usageEvent: {
      groupBy: vi.fn(async (args: { by: string[] }) =>
        args.by[0] === "repoFullName" ? (opts.eventRepos ?? []) : [],
      ),
    },
    $queryRaw: vi.fn(async () => []),
  });
  return calls;
}

const scanGroup = (repoId: string, o: Record<string, unknown> = {}) => ({
  repoId,
  engineProvider: "gemini",
  engineModel: "gemini-3-flash-preview",
  engineByom: false,
  _count: 1,
  _sum: { inputTokens: 2_000_000, outputTokens: 0 }, // $1.00 at the built-in rate
  ...o,
});
const repoRow = (id: string, fullName: string, isPrivate = true) => ({ id, fullName, isPrivate, teams: [] });

describe("getUsageSummary: one groupBy, one Repository read", () => {
  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReset();
  });

  it("asks the period for its finest key ONCE and resolves the window's repos ONCE", async () => {
    const calls = summaryPrisma({ scanGroups: [scanGroup("r1")], repos: [repoRow("r1", "acme/api")] });

    await getUsageSummary("acme", 30);

    // Two scan groupBys in total: the provider mix, and the one (repo × provider × model × byom) pass
    // the cost basis, the repo attribution and the team split are all folded out of.
    expect(calls.scanGroupBy).toHaveLength(2);
    const repoKeyed = calls.scanGroupBy.filter((a) => (a.by as string[]).includes("repoId"));
    expect(repoKeyed).toHaveLength(1);
    expect(repoKeyed[0]!.by).toEqual(["repoId", "engineProvider", "engineModel", "engineByom"]);
    expect(calls.repoFindMany).toHaveLength(1);
  });

  it("still scopes the repo attribution to BILLABLE scans — a public repo is not bill-driving volume", async () => {
    // The predicate moved from the SQL `where` into JS; it must classify identically. A public repo,
    // a mock (keyless) run and a BYOM run are all free — only the private metered scan drives a bill.
    summaryPrisma({
      scanGroups: [
        scanGroup("pub"),
        scanGroup("mock", { engineProvider: "mock" }),
        scanGroup("byom", { engineByom: true }),
        scanGroup("priv"),
      ],
      repos: [
        repoRow("pub", "acme/site", false),
        repoRow("mock", "acme/mock"),
        repoRow("byom", "acme/own"),
        repoRow("priv", "acme/api"),
      ],
    });

    const summary = await getUsageSummary("acme", 30);

    expect(summary!.byRepo.map((r) => r.fullName)).toEqual(["acme/api"]);
    expect(summary!.byRepo[0]!.estimatedCostUsd).toBeCloseTo(1, 6);
  });

  it("merges the ledger's per-repo spend into the same row, and keeps repo-less work as its own", async () => {
    summaryPrisma({
      scanGroups: [scanGroup("r1")],
      repos: [repoRow("r1", "acme/api")],
      eventRepos: [
        { repoFullName: "acme/api", _count: { _all: 4, costMicros: 4 }, _sum: { costMicros: 500_000 } },
        { repoFullName: null, _count: { _all: 2, costMicros: 2 }, _sum: { costMicros: 250_000 } },
      ],
    });

    const summary = await getUsageSummary("acme", 30);

    const api = summary!.byRepo.find((r) => r.fullName === "acme/api")!;
    expect(api.scans).toBe(1);
    expect(api.calls).toBe(5); // one billable scan + four ledger calls
    expect(api.estimatedCostUsd).toBeCloseTo(1.5, 6); // $1.00 scan lane + $0.50 ledger
    // Work with no repository is the explicit LAST row, never a dropped one.
    const last = summary!.byRepo.at(-1)!;
    expect(last.fullName).toBeNull();
    expect(last.label).toBe("Org-wide (no repo)");
    expect(last.calls).toBe(2);
  });

  it("refuses a partial dollar figure: unknown + known is unknown, per repo as per team", async () => {
    summaryPrisma({
      scanGroups: [scanGroup("r1")],
      repos: [repoRow("r1", "acme/api")],
      eventRepos: [
        // Four ledger calls nothing could price: adding only the priced half would print a confident
        // figure that omits real spend.
        { repoFullName: "acme/api", _count: { _all: 4, costMicros: 0 }, _sum: { costMicros: null } },
      ],
    });

    const summary = await getUsageSummary("acme", 30);

    const api = summary!.byRepo[0]!;
    expect(api.estimatedCostUsd).toBeNull();
    expect(api.unpricedCalls).toBe(4);
  });
});

describe("mergeRepoUsage", () => {
  const row = (o: Partial<RepoUsage> & { fullName: string | null }): RepoUsage => ({
    label: o.fullName ?? "Org-wide (no repo)",
    scans: 0,
    tokens: 0,
    calls: 1,
    estimatedCostUsd: 1,
    unpricedCalls: 0,
    ...o,
  });

  it("sorts by metered scan volume, as the panel always did, with a stable name tiebreak", () => {
    const out = mergeRepoUsage(
      [row({ fullName: "a/one", scans: 2, calls: 2 }), row({ fullName: "a/two", scans: 9, calls: 9 })],
      [],
    );
    expect(out.map((r) => r.fullName)).toEqual(["a/two", "a/one"]);
  });

  it("keeps the repo-less bucket out of the top-N race and always last", () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ fullName: `a/r${i}`, scans: 12 - i, calls: 1 }));
    const out = mergeRepoUsage(many, [row({ fullName: null, calls: 3 })]);
    expect(out).toHaveLength(11); // ten repos + the org-wide row
    expect(out.at(-1)!.fullName).toBeNull();
  });

  it("never adds a priced side to an unpriced one", () => {
    const out = mergeRepoUsage(
      [row({ fullName: "a/one", scans: 1, calls: 1, estimatedCostUsd: 2 })],
      [row({ fullName: "a/one", calls: 5, estimatedCostUsd: null, unpricedCalls: 5 })],
    );
    expect(out[0]!.estimatedCostUsd).toBeNull();
    expect(out[0]!.calls).toBe(6);
    expect(out[0]!.unpricedCalls).toBe(5);
  });
});

// G1-08 / G1-09. "Billable" is ONE predicate (isBillableScan) shared by the headline Stat tile, the
// trend chart's SQL aggregation and its JS fallback — a private repo scanned keyless (mock) or on the
// org's OWN provider (BYOM) consumed no Ascent-metered inference and is NOT billable volume. Both the
// counts and the series are bounded by the same [since, tomorrow-UTC) window, so a future-dated /
// clock-skewed row can't be counted in the tile while being idx-missed out of the chart.
describe("isBillableScan (the single-sourced billable predicate)", () => {
  const priv = { isPrivate: true, engineProvider: "anthropic" };

  it("counts a private scan on Ascent's own metered provider", () => {
    expect(isBillableScan({ ...priv, engineByom: false })).toBe(true);
    expect(isBillableScan({ ...priv, engineByom: null })).toBe(true); // unknown = platform account
    expect(isBillableScan(priv)).toBe(true);
  });

  it("does NOT count a private MOCK scan (keyless/degraded: no inference happened)", () => {
    expect(isBillableScan({ isPrivate: true, engineProvider: "mock", engineByom: false })).toBe(false);
  });

  it("does NOT count a private BYOM scan (the org already paid its own vendor)", () => {
    expect(isBillableScan({ ...priv, engineByom: true })).toBe(false);
  });

  it("never counts a public scan, however it ran", () => {
    expect(isBillableScan({ isPrivate: false, engineProvider: "anthropic", engineByom: false })).toBe(false);
  });
});

interface FixtureScan {
  at: Date;
  isPrivate: boolean;
  engineProvider: string;
  engineByom: boolean | null;
}

/** The Prisma `where` shapes usage.ts builds (window + billable clauses). */
interface StubWhere {
  scannedAt?: { gte?: Date; lt?: Date };
  repo?: { orgId?: string; isPrivate?: boolean };
  engineProvider?: { not?: string };
  OR?: { engineByom: boolean | null }[];
}

/** Honest interpreter of those shapes, so count/findMany filter exactly as Prisma would. */
function whereMatches(row: FixtureScan, where: StubWhere): boolean {
  if (where.scannedAt?.gte && row.at < where.scannedAt.gte) return false;
  if (where.scannedAt?.lt && row.at >= where.scannedAt.lt) return false;
  if (where.repo?.isPrivate !== undefined && row.isPrivate !== where.repo.isPrivate) return false;
  if (where.engineProvider?.not !== undefined && row.engineProvider === where.engineProvider.not) return false;
  if (where.OR && !where.OR.some((c) => c.engineByom === row.engineByom)) return false;
  return true;
}

/**
 * A stub Prisma driven by a scan fixture. `$queryRaw` emulates the aggregation query using the values
 * bound into the tagged template (so the test proves the provider name AND both window bounds really
 * reach SQL) and Postgres's own three-valued `IS NOT TRUE` semantics — never isBillableScan — so the
 * SQL transcription is checked against the JS predicate rather than assumed equal to it.
 * `rawFails: true` forces the row-bucketing fallback path.
 */
function stubPrisma(rows: FixtureScan[], rawFails = false) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org1", slug: "acme" })) },
    repository: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
    scan: {
      count: vi.fn(async ({ where }: { where: StubWhere }) =>
        rows.filter((r) => whereMatches(r, where)).length,
      ),
      groupBy: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _min: { scannedAt: null }, _max: { scannedAt: null } })),
      findMany: vi.fn(async ({ where }: { where: StubWhere }) =>
        rows
          .filter((r) => whereMatches(r, where))
          .map((r) => ({
            scannedAt: r.at,
            engineProvider: r.engineProvider,
            engineByom: r.engineByom,
            repo: { isPrivate: r.isPrivate },
          })),
      ),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (rawFails) throw new Error("raw unavailable");
      const [provider, , since, before] = values as [string, string, Date, Date];
      const buckets = new Map<string, number>();
      for (const r of rows) {
        if (r.at < since || r.at >= before) continue; // WHERE scannedAt >= since AND < before
        // (r."isPrivate" AND s."engineProvider" <> $1 AND s."engineByom" IS NOT TRUE)
        const billable = r.isPrivate && r.engineProvider !== provider && r.engineByom !== true;
        const key = `${r.at.toISOString().slice(0, 10)}|${billable}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      return [...buckets].map(([key, count]) => {
        const [day, billable] = key.split("|");
        return { day, billable: billable === "true", count };
      });
    }),
  };
}

describe("getUsageSummary billable metering (G1-08) + window bounds (G1-09)", () => {
  const NOW = Date.UTC(2026, 6, 28, 12, 0, 0); // 2026-07-28 12:00Z
  const on = (dayOffset: number) => new Date(Date.UTC(2026, 6, 28) + dayOffset * 86_400_000 + 3_600_000);
  const fixture: FixtureScan[] = [
    { at: on(0), isPrivate: true, engineProvider: "anthropic", engineByom: false }, // billable
    { at: on(0), isPrivate: true, engineProvider: "anthropic", engineByom: null }, // billable (unknown)
    { at: on(-1), isPrivate: true, engineProvider: "mock", engineByom: false }, // private mock -> free
    { at: on(-1), isPrivate: true, engineProvider: "bedrock", engineByom: true }, // private BYOM -> free
    { at: on(-2), isPrivate: false, engineProvider: "anthropic", engineByom: false }, // public -> free
    { at: on(1), isPrivate: true, engineProvider: "anthropic", engineByom: false }, // FUTURE-dated
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("counts only private+metered scans as billable, in the tile AND the chart", async () => {
    mockGetPrisma.mockReturnValue(stubPrisma(fixture));
    const s = (await getUsageSummary("acme", 7))!;

    // 2 billable: the private mock and the private BYOM scan are free, not billable.
    expect(s.privateScans).toBe(2);
    const chartBillable = s.daily.reduce((a, d) => a + d.billable, 0);
    const chartFree = s.daily.reduce((a, d) => a + d.free, 0);
    expect(chartBillable).toBe(s.privateScans); // tile === chart, by construction
    expect(chartFree).toBe(s.publicScans);
    // billable + free === the period total: nothing lands outside the two series.
    expect(s.privateScans + s.publicScans).toBe(s.periodScans);
    expect(s.publicScans).toBe(3); // mock + BYOM + public
  });

  it("excludes a future-dated scan from BOTH the headline count and the series", async () => {
    mockGetPrisma.mockReturnValue(stubPrisma(fixture));
    const s = (await getUsageSummary("acme", 7))!;
    expect(s.periodScans).toBe(5); // the on(+1) row is outside [since, tomorrow-UTC)
    expect(s.privateScans).toBe(2); // …and not in the billable tile either
    expect(s.daily.map((d) => d.date).at(-1)).toBe("2026-07-28"); // axis stops at today
    expect(s.daily.reduce((a, d) => a + d.billable + d.free, 0)).toBe(s.periodScans);
  });

  it("produces an IDENTICAL series from the SQL path and the JS row-bucketing fallback", async () => {
    mockGetPrisma.mockReturnValue(stubPrisma(fixture));
    const sql = (await getUsageSummary("acme", 7))!;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetPrisma.mockReturnValue(stubPrisma(fixture, true));
    const fallback = (await getUsageSummary("acme", 7))!;
    errSpy.mockRestore();

    expect(fallback.daily).toEqual(sql.daily);
    expect(sql.daily.find((d) => d.date === "2026-07-28")).toMatchObject({ billable: 2, free: 0 });
    expect(sql.daily.find((d) => d.date === "2026-07-27")).toMatchObject({ billable: 0, free: 2 });
    expect(sql.daily.find((d) => d.date === "2026-07-26")).toMatchObject({ billable: 0, free: 1 });
  });
});

describe("buildDailySeries", () => {
  const anchor = Date.UTC(2026, 5, 3); // 2026-06-03 UTC

  it("buckets by UTC day with a billable/free split on a stable axis", () => {
    const series = buildDailySeries(3, anchor, [
      { at: new Date(Date.UTC(2026, 5, 3, 10)), billable: true },
      { at: new Date(Date.UTC(2026, 5, 3, 23)), billable: false },
      { at: new Date(Date.UTC(2026, 5, 2, 1)), billable: true },
      { at: new Date(Date.UTC(2026, 4, 1)), billable: true }, // before the window -> dropped
    ]);
    expect(series.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(series.find((d) => d.date === "2026-06-03")).toMatchObject({ billable: 1, free: 1 });
    expect(series.find((d) => d.date === "2026-06-02")).toMatchObject({ billable: 1, free: 0 });
    expect(series.find((d) => d.date === "2026-06-01")).toMatchObject({ billable: 0, free: 0 });
  });
});

// The single-sourced ?days= clamp shared by /usage (page) and /api/usage (route). The FLOOR is the
// fix for the fractional-days bug: an un-floored 1.5 stepped the day axis by half-days, so the newest
// UTC day never landed on a generated axis key and the chart/CSV dropped it while the counts kept it.
describe("boundUsageDays", () => {
  it("floors a fractional ?days= so the window is always a whole day (1.5 → 1)", () => {
    expect(boundUsageDays("1.5", false)).toBe(1);
    expect(boundUsageDays("30.9", false)).toBe(30);
    expect(boundUsageDays("7.0001", false)).toBe(7);
  });

  it("falls back to 30 for non-numeric / empty / sub-1 input", () => {
    expect(boundUsageDays(undefined, false)).toBe(30);
    expect(boundUsageDays(null, false)).toBe(30);
    expect(boundUsageDays("", false)).toBe(30);
    expect(boundUsageDays("abc", false)).toBe(30);
    // floor(0.5) === 0 → falsy → the 30 default (a sub-day window is meaningless for a per-day series).
    expect(boundUsageDays("0.5", false)).toBe(30);
    expect(boundUsageDays("0", false)).toBe(30);
  });

  it("clamps to at least 1 day (a negative window is nonsense)", () => {
    expect(boundUsageDays("-5", false)).toBe(1); // floor(-5) = -5 (truthy) → max(1, -5) = 1
  });

  it("caps the PUBLIC funnel tighter (90d) than a private org (365d)", () => {
    expect(boundUsageDays("1000", true)).toBe(90);
    expect(boundUsageDays("91", true)).toBe(90);
    expect(boundUsageDays("1000", false)).toBe(365);
  });
});

describe("the newest day only survives on an INTEGER window (the fractional-days fix)", () => {
  const anchorUtcMs = Date.UTC(2026, 6, 9); // 2026-07-09 00:00Z is the axis anchor
  const todayScan = { at: new Date(Date.UTC(2026, 6, 9, 10, 0, 0)), billable: true };

  it("drops today when periodDays is fractional (the pre-fix bug)", () => {
    // 1.5 steps the axis by half a day: the only bucket is 2026-07-08 and today's scan is idx-missed.
    const series = buildDailySeries(1.5, anchorUtcMs, [todayScan]);
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-07-08");
    expect(series[0]!.billable).toBe(0);
  });

  it("keeps today once the window is floored via boundUsageDays", () => {
    const days = boundUsageDays("1.5", false); // → 1
    const series = buildDailySeries(days, anchorUtcMs, [todayScan]);
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-07-09"); // today is on the axis
    expect(series[0]!.billable).toBe(1); // and its scan is counted
  });
});

// ── The lane + team views (#11) ──────────────────────────────────────────────────────────────────
//
// Two properties, both about NOT losing or duplicating spend: the `scan` lane is derived from the
// Scan rows the summary already counted (a UsageEvent mirror would double it), and a repo with no
// CODEOWNERS owner lands in an explicit org-wide bucket rather than falling out of the report.

describe("getUsageSummary — byLane and byTeam", () => {
  /** A prisma stub carrying one gemini scan group over two repos, and one Athena UsageEvent group. */
  function stub(opts: { teams?: { slug: string }[] } = {}) {
    const scanGroupBy = vi.fn(async (args: { by: string[] }) => {
      if (args.by.includes("repoId") && args.by.includes("engineModel")) {
        return [
          {
            repoId: "r1",
            engineProvider: "gemini",
            engineModel: "gemini-3.7-flash",
            _count: 3,
            _sum: { inputTokens: 2_000_000, outputTokens: 1_000_000 },
          },
        ];
      }
      if (args.by.includes("repoId")) return [];
      if (args.by.includes("engineModel")) {
        return [
          {
            engineProvider: "gemini",
            engineModel: "gemini-3.7-flash",
            _count: 3,
            _sum: { inputTokens: 2_000_000, outputTokens: 1_000_000 },
          },
        ];
      }
      return [{ engineProvider: "gemini", _count: 3 }];
    });
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org1", slug: "acme" })) },
      scan: {
        count: vi.fn(async () => 3),
        groupBy: scanGroupBy,
        aggregate: vi.fn(async () => ({ _min: { scannedAt: null }, _max: { scannedAt: null } })),
      },
      repository: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [{ id: "r1", fullName: "acme/api", teams: opts.teams ?? [] }]),
      },
      usageEvent: {
        groupBy: vi.fn(async (args: { by: string[] }) =>
          args.by.includes("lane")
            ? [{ lane: "athena", _count: 2, _sum: { inputTokens: 100, outputTokens: 20, costMicros: 5_000 } }]
            : [{ teamKey: null, _count: 2, _sum: { costMicros: 5_000 } }],
        ),
      },
      $queryRaw: vi.fn(async () => []),
    });
    return scanGroupBy;
  }

  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReset();
  });

  it("derives byLane[scan] from the Scan rows the summary already counted — no double count", async () => {
    stub();
    const s = (await getUsageSummary("acme", 30))!;
    const scan = s.byLane.find((l) => l.lane === "scan")!;
    // Identical to the headline figures, BY CONSTRUCTION: same source, folded once.
    expect(scan.calls).toBe(s.periodScans);
    expect(scan.inputTokens).toBe(s.inputTokens);
    expect(scan.outputTokens).toBe(s.outputTokens);
    expect(scan.estimatedCostUsd).toBe(s.estimatedCostUsd);
    expect(scan.unpricedCalls).toBe(0);
    // …and the lanes that have no Scan ledger come from UsageEvent, beside it rather than inside it.
    expect(s.byLane.find((l) => l.lane === "athena")).toMatchObject({ calls: 2, estimatedCostUsd: 0.005 });
  });

  it("sums EVERY lane into the headline cost, not just the scan lane (VICTOR-L1-05)", async () => {
    stub();
    const s = (await getUsageSummary("acme", 30))!;
    // The headline the /usage tile reads must equal what "Spend by lane" sums to, by construction.
    const laneSum = s.byLane.reduce((a, l) => a + (l.estimatedCostUsd ?? 0), 0);
    expect(s.allLanesCostUsd).toBeCloseTo(laneSum, 10);
    // …and it is strictly MORE than the scan-lane figure once another lane spent money.
    expect(s.allLanesCostUsd!).toBeGreaterThan(s.estimatedCostUsd!);
    // The floor qualifier is the lane rows' own unpriced counts, summed — the headline can never
    // disclose less unpriced volume than the itemization under it.
    expect(s.allLanesUnpricedCalls).toBe(s.byLane.reduce((a, l) => a + l.unpricedCalls, 0));
  });

  it("puts a repo with NO codeowning team in the explicit org-wide bucket instead of dropping it", async () => {
    stub({ teams: [] });
    const s = (await getUsageSummary("acme", 30))!;
    const orgWide = s.byTeam.find((t) => t.teamKey === null);
    expect(orgWide).toBeDefined();
    // 3 scans on the team-less repo + the 2 team-less Athena events.
    expect(orgWide!.calls).toBe(5);
    expect(s.byTeam.reduce((a, t) => a + t.calls, 0)).toBe(5);
  });

  it("attributes a repo WITH a default owner to that team", async () => {
    stub({ teams: [{ slug: "@acme/platform" }] });
    const s = (await getUsageSummary("acme", 30))!;
    expect(s.byTeam.find((t) => t.teamKey === "@acme/platform")).toMatchObject({ calls: 3 });
    expect(s.byTeam.find((t) => t.teamKey === null)).toMatchObject({ calls: 2 });
  });

  it("omits the team view entirely for the public funnel — no tenant, no teams", async () => {
    stub({ teams: [{ slug: "@acme/platform" }] });
    const s = (await getUsageSummary("public", 30))!;
    expect(s.byTeam).toEqual([]);
    // The lane view still works: the public funnel's scan volume is a real, readable figure.
    expect(s.byLane.map((l) => l.lane)).toEqual(["scan"]);
  });
});

// Direction 8 — BYOM tokens are not priced into the org's cost. `meter()` already refuses to price a
// BYOM call on every OTHER lane (`if (byom === true) return null`), and usage.md states the rule for
// all of them; the scan lane grouped its tokens with no byom filter and handed them straight to
// estimateLlmCostFromTable. An org running BYOM scans saw a dollar figure for tokens it had already
// paid its own vendor for — the one number on this page that could OVERSTATE money.
describe("getUsageSummary — BYOM scan tokens are counted but never priced (Direction 8)", () => {
  const PRICED = { engineProvider: "gemini", engineModel: "gemini-3.7-flash", engineByom: false, _count: 3, _sum: { inputTokens: 2_000_000, outputTokens: 1_000_000 } };
  const BYOM = { engineProvider: "gemini", engineModel: "gemini-3.7-flash", engineByom: true, _count: 2, _sum: { inputTokens: 4_000_000, outputTokens: 2_000_000 } };

  /** A prisma stub whose per-model groupBy returns exactly `modelRows` (already split by engineByom).
   *  The period is now asked for ONE grouping — (repoId, provider, model, byom) — and the cost basis
   *  is a fold of it, so the rows carry a repo id they did not need when the model pass was its own
   *  query. Every figure below is unchanged by that: the fold sums the same rows. */
  function stub(modelRows: typeof PRICED[]) {
    const groupBy = vi.fn(async (args: { by: string[] }) => {
      if (args.by.includes("engineModel")) return modelRows.map((r) => ({ repoId: "r1", ...r }));
      return [{ engineProvider: "gemini", _count: modelRows.reduce((a, r) => a + r._count, 0) }];
    });
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org1", kind: "org" })) },
      scan: {
        count: vi.fn(async () => modelRows.reduce((a, r) => a + r._count, 0)),
        groupBy,
        aggregate: vi.fn(async () => ({ _min: { scannedAt: null }, _max: { scannedAt: null } })),
      },
      repository: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
      usageEvent: { groupBy: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    });
    return groupBy;
  }

  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReset();
  });

  it("splits the priced fold on engineByom in SQL rather than pricing the whole window", async () => {
    const groupBy = stub([PRICED, BYOM]);
    await getUsageSummary("acme", 30);
    // `engineByom` rides in the ONE grouping key the period is asked for, so the BYOM half can be
    // split out of the priced fold without a second query.
    const modelCall = groupBy.mock.calls
      .map((c) => (c as unknown[])[0] as { by: string[] })
      .find((a) => a.by.includes("engineModel"));
    expect(modelCall!.by).toContain("engineByom");
  });

  it("prices ONLY the platform-account half of a mixed window", async () => {
    stub([PRICED, BYOM]);
    const s = (await getUsageSummary("acme", 30))!;
    // The estimate is exactly the non-BYOM half — not the whole 9M tokens.
    const pricedOnly = estimateLlmCostFromTable([
      { model: "gemini-3.7-flash", provider: "gemini", inputTokens: 2_000_000, outputTokens: 1_000_000 },
    ])!;
    expect(s.estimatedCostUsd).toBeCloseTo(pricedOnly, 10);
    const all = estimateLlmCostFromTable([
      { model: "gemini-3.7-flash", provider: "gemini", inputTokens: 6_000_000, outputTokens: 3_000_000 },
    ])!;
    expect(s.estimatedCostUsd).toBeLessThan(all);
  });

  it("still counts the BYOM tokens in the volume tiles — they were really consumed", async () => {
    stub([PRICED, BYOM]);
    const s = (await getUsageSummary("acme", 30))!;
    expect(s.inputTokens).toBe(6_000_000);
    expect(s.outputTokens).toBe(3_000_000);
  });

  it("reports the BYOM scans separately and as unpriced calls, so the gap is explained", async () => {
    stub([PRICED, BYOM]);
    const s = (await getUsageSummary("acme", 30))!;
    expect(s.byomScans).toBe(2);
    // Same shape as every other unpriceable call: disclosed volume, never a silent $0.
    expect(s.byLane.find((l) => l.lane === "scan")!.unpricedCalls).toBe(2);
    expect(s.allLanesUnpricedCalls).toBe(2);
  });

  it("gives a BYOM-ONLY window no estimate at all — null, never $0.00", async () => {
    stub([BYOM]);
    const s = (await getUsageSummary("acme", 30))!;
    expect(s.estimatedCostUsd).toBeNull();
    expect(s.allLanesCostUsd).toBeNull();
    expect(s.costBasis).toBeNull();
    expect(s.byomScans).toBe(2);
  });

  it("does not let the operator's env rates price BYOM tokens either", async () => {
    const prev = [process.env.LLM_INPUT_COST_PER_MTOK, process.env.LLM_OUTPUT_COST_PER_MTOK];
    process.env.LLM_INPUT_COST_PER_MTOK = "3";
    process.env.LLM_OUTPUT_COST_PER_MTOK = "15";
    try {
      stub([PRICED, BYOM]);
      const mixed = (await getUsageSummary("acme", 30))!;
      // 2M in + 1M out at the configured rates — the BYOM 4M/2M contributes nothing.
      expect(mixed.estimatedCostUsd).toBeCloseTo(2 * 3 + 1 * 15, 10);
      expect(mixed.costBasis).toBe("env");
      stub([BYOM]);
      const only = (await getUsageSummary("acme", 30))!;
      // Configured rates and nothing they may price: "no estimate", not a $0 that reads as free.
      expect(only.estimatedCostUsd).toBeNull();
    } finally {
      if (prev[0] === undefined) delete process.env.LLM_INPUT_COST_PER_MTOK;
      else process.env.LLM_INPUT_COST_PER_MTOK = prev[0];
      if (prev[1] === undefined) delete process.env.LLM_OUTPUT_COST_PER_MTOK;
      else process.env.LLM_OUTPUT_COST_PER_MTOK = prev[1];
    }
  });
});

describe("estimateLlmCostFromTable / unpricedScanCalls — the BYOM guard (Direction 8)", () => {
  const row = { model: "gemini-3.7-flash", provider: "gemini", inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("skips a BYOM row without setting pricedAny — a BYOM-only fold is null, not 0", () => {
    expect(estimateLlmCostFromTable([{ ...row, byom: true }])).toBeNull();
  });

  it("prices the platform rows beside it unchanged", () => {
    const both = estimateLlmCostFromTable([row, { ...row, byom: true }]);
    expect(both).toBeCloseTo(estimateLlmCostFromTable([row])!, 10);
  });

  it("counts a BYOM call as unpriced even on a zero-cost local provider", () => {
    expect(unpricedScanCalls([{ ...row, provider: "ollama", byom: true, calls: 4 }])).toBe(4);
    // …while the same local run on Ascent's own account has a real price, and it is zero.
    expect(unpricedScanCalls([{ ...row, provider: "ollama", byom: false, calls: 4 }])).toBe(0);
  });
});

// Direction 9 (a)+(e). The page is honest about WHEN: one shared half-open UTC-day window, echoed on
// the response, and a zero-fill that stops at the org's first scan instead of exporting 360 rows of
// "0 scans" for days before the org existed. Absent is not zero.
describe("usageWindow — the ONE window every reader of the period shares", () => {
  it("is half-open, UTC-day-anchored, and exactly periodDays wide", () => {
    const w = usageWindow(7, Date.UTC(2026, 6, 28, 17, 43, 12));
    expect(w.since.toISOString()).toBe("2026-07-22T00:00:00.000Z");
    // EXCLUSIVE upper bound: midnight UTC of tomorrow, not "now" — so today's scans are all inside.
    expect(w.before.toISOString()).toBe("2026-07-29T00:00:00.000Z");
    expect((w.before.getTime() - w.since.getTime()) / 86_400_000).toBe(7);
  });

  it("does not move with the wall clock inside a day — the trap the credit cutoff fell into", () => {
    const morning = usageWindow(30, Date.UTC(2026, 6, 28, 0, 1));
    const evening = usageWindow(30, Date.UTC(2026, 6, 28, 23, 59));
    expect(morning).toEqual(evening);
  });
});

describe("clampDailySeries — the zero-fill stops at the org's first scan (Direction 9e)", () => {
  const days = (from: string, n: number): UsageDay[] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      billable: 0,
      free: 0,
    }));

  it("trims the days before the first scan and reports the effective start", () => {
    const series = days("2026-01-01", 30);
    const out = clampDailySeries(series, new Date("2026-01-01T00:00:00.000Z"), "2026-01-26T09:30:00.000Z");
    expect(out.daily).toHaveLength(5); // 26th..30th
    expect(out.daily[0]!.date).toBe("2026-01-26");
    expect(out.effectiveSince).toBe("2026-01-26T00:00:00.000Z");
  });

  it("keeps the first scan's OWN day — the day it happened is measured, not trimmed", () => {
    const out = clampDailySeries(days("2026-01-01", 30), new Date("2026-01-01T00:00:00.000Z"), "2026-01-26T00:00:00.000Z");
    expect(out.daily[0]!.date).toBe("2026-01-26");
  });

  it("leaves a window that starts after the first scan alone — nothing to shorten", () => {
    const series = days("2026-01-01", 30);
    const out = clampDailySeries(series, new Date("2026-01-01T00:00:00.000Z"), "2025-11-02T00:00:00.000Z");
    expect(out.daily).toBe(series);
    expect(out.effectiveSince).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves an org with NO scans alone — an honest all-zero axis, with no first scan to clamp to", () => {
    const series = days("2026-01-01", 30);
    expect(clampDailySeries(series, new Date("2026-01-01T00:00:00.000Z"), null).daily).toBe(series);
  });
});

describe("getUsageSummary — echoes the window it actually covered (Direction 9)", () => {
  const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
  function stub(firstScan: Date | null) {
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org1", kind: "org" })) },
      scan: {
        count: vi.fn(async () => 1),
        groupBy: vi.fn(async () => []),
        aggregate: vi.fn(async () => ({ _min: { scannedAt: firstScan }, _max: { scannedAt: firstScan } })),
      },
      repository: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
      usageEvent: { groupBy: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockGetPrisma.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("returns the half-open window and names the timezone, so no reader rebuilds it from a local clock", async () => {
    stub(new Date(Date.UTC(2020, 0, 1)));
    const s = (await getUsageSummary("acme", 30))!;
    expect(s.windowSince).toBe("2026-06-29T00:00:00.000Z");
    expect(s.windowBefore).toBe("2026-07-29T00:00:00.000Z");
    expect(s.timezone).toBe("UTC");
    expect(s.effectiveSince).toBe(s.windowSince); // an old org: nothing to clamp
    expect(s.effectiveDays).toBe(30);
    expect(s.daily).toHaveLength(30);
  });

  it("clamps a 365-day window on a five-day-old org instead of exporting 360 measured zeros", async () => {
    stub(new Date(Date.UTC(2026, 6, 24, 8, 0)));
    const s = (await getUsageSummary("acme", 365))!;
    expect(s.periodDays).toBe(365); // what was asked for, unchanged
    expect(s.daily).toHaveLength(5); // …what was actually measured
    expect(s.effectiveDays).toBe(5);
    expect(s.effectiveSince).toBe("2026-07-24T00:00:00.000Z");
    expect(s.effectiveSince).not.toBe(s.windowSince); // the page says "window shortened to first scan"
    expect(s.daily[0]!.date).toBe("2026-07-24");
    expect(s.daily.at(-1)!.date).toBe("2026-07-28");
  });

  it("accepts a caller-supplied window verbatim, so a sibling read can share it exactly", async () => {
    stub(new Date(Date.UTC(2020, 0, 1)));
    const win = usageWindow(7, Date.UTC(2026, 0, 10, 6, 0));
    const s = (await getUsageSummary("acme", 7, win))!;
    expect(s.windowSince).toBe(win.since.toISOString());
    expect(s.windowBefore).toBe(win.before.toISOString());
  });
});
