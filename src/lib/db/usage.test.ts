// Billing-aggregation invariants: the cost estimate must never silently bill at $0 when a rate is
// unset (the half-billing trap), the per-day series must bucket by UTC day with a billable/free
// split on a stable axis, and the "top repos by metered scans" aggregate must scope to PRIVATE
// repos (free public scans are not metered volume). The DB client is mocked so the import never
// loads Prisma; getUsageSummary runs against a stubbed client.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => false),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import { boundUsageDays, buildDailySeries, estimateLlmCostFromTable, estimateLlmCostUsd, getUsageSummary } from "./usage";

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

describe("getUsageSummary byRepo scope (usage-metering 06-11 #4)", () => {
  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReset();
  });

  it("groups the top-repos aggregate over PRIVATE repos only (metered = billable)", async () => {
    const groupBy = vi.fn(async () => []);
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org1", slug: "acme" })) },
      scan: {
        count: vi.fn(async () => 0),
        groupBy,
        aggregate: vi.fn(async () => ({
          _min: { scannedAt: null },
          _max: { scannedAt: null },
          _sum: { inputTokens: 0, outputTokens: 0 },
        })),
      },
      repository: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => []),
    });

    const summary = await getUsageSummary("acme", 30);

    expect(summary).not.toBeNull();
    const byRepoCall = groupBy.mock.calls
      .map((c) => (c as unknown[])[0] as { by: string[]; where: Record<string, unknown> })
      .find((args) => args.by.includes("repoId"));
    expect(byRepoCall).toBeDefined();
    // The metered-attribution panel must not count FREE public scans as billable volume.
    expect(byRepoCall!.where.repo).toEqual({ orgId: "org1", isPrivate: true });
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
