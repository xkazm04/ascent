// The GOD-SCAN TREND metric on the operator KPI pull.
//
// `classifyOutputBudget` (src/lib/llm/output-budget.ts) warns about ONE scan. This answers the
// question that actually triggers a design change: are scans TRENDING toward the model's output
// ceiling? When they are, the fix is to split the single-call assessment into per-dimension calls,
// not to buy a bigger model — and that decision needs a fleet-wide trend, not one loud scan.
//
// `scanOutputBudget` came with this file. The three PAGED readers below were added when their
// unbounded reads were replaced (explorer, 2026-08-29): each used to materialize a whole table on an
// endpoint that runs every metric at once, and each now walks its cohort in KPI_PAGE_SIZE pages. The
// rewrite had to leave the reported numbers identical, so the tests below are about the ARITHMETIC
// surviving pagination - the cohort rules, the window edges, and the second-scan identification -
// not about the query shape.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import {
  avgLlmCostPerActiveOrg,
  firstScanActivationRate,
  reScanRate,
  roadmapEngagementRate,
  scanOutputBudget,
} from "./kpi-metrics";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** A prisma double whose findMany calls return fixed rows and record the args they were called
 *  with, so a test can assert both the number and the fact that the walk terminated. */
function fakePrisma(models: Record<string, unknown>) {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue(models);
}

/** findMany that serves `rows` on the first call and nothing afterwards — one page, then the end. */
const onePage = (rows: unknown[]) => {
  let served = false;
  return vi.fn(async () => {
    if (served) return [];
    served = true;
    return rows;
  });
};

const scan = (outputTokens: number, engineModel = "claude-opus-5") => ({ engineModel, outputTokens });

function withScans(rows: { engineModel: string; outputTokens: number }[]) {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({ scan: { findMany: vi.fn(async () => rows) } });
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
});

describe("scanOutputBudget", () => {
  it("returns null with no database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await scanOutputBudget()).toBeNull();
  });

  // "Not measured" and "comfortably small" are different statements. A mock-only or keyless
  // deployment reports no usage at all, and must not read as a healthy trend.
  it("returns null when no scan in the window reported usage", async () => {
    withScans([]);
    expect(await scanOutputBudget()).toBeNull();
  });

  it("reports median and p95 output tokens", async () => {
    withScans([scan(1000), scan(2000), scan(3000), scan(4000), scan(12000)]);
    const m = (await scanOutputBudget())!;
    expect(m.scans).toBe(5);
    expect(m.medianOutputTokens).toBe(3000);
    expect(m.p95OutputTokens).toBe(12000);
  });

  // p95, NOT the mean. The mean is dominated by small repos and stays reassuring long after the
  // largest repos have started truncating — and the scans that hit the ceiling ARE the tail.
  it("stays ok while only the tail is large, and escalates once the tail nears the cap", async () => {
    withScans([scan(1000), scan(1000), scan(1000), scan(12000)]);
    expect((await scanOutputBudget())!.level).toBe("ok"); // 12k of 64k = 19%

    withScans([scan(1000), scan(1000), scan(1000), scan(60000)]);
    expect((await scanOutputBudget())!.level).toBe("at-risk"); // 60k of 64k = 94%
  });

  // Mixed-engine fleets must stay comparable: the same token count is comfortable on a 64k model and
  // fatal on an 8k one, so the percentile is taken over each scan's SHARE of its own ceiling.
  it("compares against each scan's own model ceiling, not one absolute number", async () => {
    withScans([scan(7000, "claude-opus-5"), scan(7000, "haiku")]);
    const m = (await scanOutputBudget())!;
    expect(m.worst?.model).toBe("haiku"); // 7000/8192 = 85%, vs 11% on opus
    expect(m.level).toBe("at-risk");
  });

  it("names the single worst scan so an operator can go and look at it", async () => {
    withScans([scan(1000), scan(58000)]);
    expect((await scanOutputBudget())!.worst).toMatchObject({ model: "claude-opus-5", outputTokens: 58000 });
  });

  // The real measurement, pinned as a regression anchor: a live claude-opus-5 assessment of
  // vercel/sandbox on 2026-08-14 emitted 11,908 output tokens against a 64,000 ceiling. If a future
  // rubric change pushes a comparable scan past the approaching band, this is the shape that moves.
  it("grades the measured live-Opus-5 baseline as comfortable", async () => {
    withScans([scan(11908, "claude-opus-5")]);
    const m = (await scanOutputBudget())!;
    expect(m.p95PctOfCap).toBe(19);
    expect(m.level).toBe("ok");
  });
});

describe("firstScanActivationRate", () => {
  it("returns null with no database", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await firstScanActivationRate()).toBeNull();
  });

  it("credits a scan inside the window and keeps the rest in the denominator", async () => {
    const signup = daysAgo(30);
    fakePrisma({
      user: {
        findMany: onePage([
          { id: "u1", createdAt: signup, memberships: [{ orgId: "o1" }] },
          { id: "u2", createdAt: signup, memberships: [{ orgId: "o2" }] },
          // No org at all: cannot activate, still a signup that never reached a report.
          { id: "u3", createdAt: signup, memberships: [] },
        ]),
      },
      scan: {
        findMany: vi.fn(async () => [
          // Inside u1's 7-day window…
          { scannedAt: new Date(signup.getTime() + 2 * DAY), repo: { orgId: "o1" } },
          // …and outside u2's.
          { scannedAt: new Date(signup.getTime() + 9 * DAY), repo: { orgId: "o2" } },
        ]),
      },
    });

    expect(await firstScanActivationRate(7)).toEqual({
      value: (1 / 3) * 100,
      numerator: 1,
      denominator: 3,
    });
  });

  it("reads the scans for a whole page in ONE query, not one per user", async () => {
    const scanFindMany = vi.fn(async () => []);
    fakePrisma({
      user: {
        findMany: onePage(
          Array.from({ length: 25 }, (_, i) => ({
            id: `u${i}`,
            createdAt: daysAgo(30),
            memberships: [{ orgId: `o${i}` }],
          })),
        ),
      },
      scan: { findMany: scanFindMany },
    });

    await firstScanActivationRate(7);
    expect(scanFindMany).toHaveBeenCalledTimes(1);
  });

  it("returns null when nobody has signed up outside the window", async () => {
    fakePrisma({ user: { findMany: vi.fn(async () => []) }, scan: { findMany: vi.fn(async () => []) } });
    expect(await firstScanActivationRate()).toBeNull();
  });
});

describe("reScanRate", () => {
  it("counts a repo whose second scan landed inside the window", async () => {
    const first = daysAgo(90);
    fakePrisma({
      repository: { findMany: onePage([{ id: "r1" }, { id: "r2" }]) },
      scan: {
        findMany: vi
          .fn()
          // firsts
          .mockResolvedValueOnce([
            { id: "s1", repoId: "r1", scannedAt: first },
            { id: "s2", repoId: "r2", scannedAt: first },
          ])
          // seconds: r1 re-scanned in time, r2 far too late
          .mockResolvedValueOnce([
            { repoId: "r1", scannedAt: new Date(first.getTime() + 10 * DAY) },
            { repoId: "r2", scannedAt: new Date(first.getTime() + 60 * DAY) },
          ]),
      },
    });

    expect(await reScanRate(30)).toEqual({ value: 50, numerator: 1, denominator: 2 });
  });

  it("excludes a repo whose window has not closed yet", async () => {
    fakePrisma({
      repository: { findMany: onePage([{ id: "r1" }]) },
      scan: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "s1", repoId: "r1", scannedAt: daysAgo(2) }])
          .mockResolvedValueOnce([]),
      },
    });

    expect(await reScanRate(30)).toBeNull(); // no eligible repo — not 0%
  });

  it("never asks for second scans when no repo in the page has a first", async () => {
    const scanFindMany = vi.fn(async () => []);
    fakePrisma({ repository: { findMany: onePage([{ id: "r1" }]) }, scan: { findMany: scanFindMany } });

    expect(await reScanRate(30)).toBeNull();
    expect(scanFindMany).toHaveBeenCalledTimes(1); // firsts only; the exclusion query is skipped
  });
});

describe("roadmapEngagementRate", () => {
  it("counts a scan whose recommendation moved inside the window", async () => {
    const delivered = daysAgo(60);
    fakePrisma({
      scan: {
        findMany: onePage([
          { id: "sc1", scannedAt: delivered },
          { id: "sc2", scannedAt: delivered },
        ]),
      },
      recommendationEvent: {
        findMany: vi.fn(async () => [
          { createdAt: new Date(delivered.getTime() + 3 * DAY), recommendation: { scanId: "sc1" } },
          // sc2 was acted on, but long after the window closed.
          { createdAt: new Date(delivered.getTime() + 40 * DAY), recommendation: { scanId: "sc2" } },
        ]),
      },
    });

    expect(await roadmapEngagementRate(14)).toEqual({ value: 50, numerator: 1, denominator: 2 });
  });

  it("returns null when no scan is old enough to have been acted on", async () => {
    fakePrisma({
      scan: { findMany: vi.fn(async () => []) },
      recommendationEvent: { findMany: vi.fn(async () => []) },
    });
    expect(await roadmapEngagementRate()).toBeNull();
  });
});

// ── avgLlmCostPerActiveOrg (#11) ────────────────────────────────────────────────────────────────
//
// The per-TENANT cost across every lane, not the per-scan cost. Two properties: an org that only ran
// non-scan work is still active (it is spending), and an unpriceable call is excluded from the mean
// rather than entering it at zero — which would drag the average down exactly when an unrecognised
// (usually newer, pricier) model shows up.

describe("avgLlmCostPerActiveOrg", () => {
  beforeEach(() => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReset();
  });

  it("folds scan cost and ledger cost over the SAME set of active orgs", async () => {
    fakePrisma({
      scan: {
        findMany: vi.fn(async () => [
          // 1M in + 1M out on Gemini 3 Flash = $0.50 + $3.00.
          {
            engineProvider: "gemini",
            engineModel: "gemini-3-flash-preview",
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            repo: { orgId: "org1" },
          },
        ]),
      },
      usageEvent: {
        groupBy: vi.fn(async (args: { where: Record<string, unknown> }) =>
          "costMicros" in args.where
            ? [{ orgId: "org2", _count: 3 }]
            : [
                { orgId: "org1", _sum: { costMicros: 1_500_000 } }, // $1.50 of Athena on org1
                { orgId: "org2", _sum: { costMicros: null } }, // org2 spent, but unpriceably
              ],
        ),
      },
    });
    const m = (await avgLlmCostPerActiveOrg(30))!;
    // org2 is ACTIVE even though it ran no scan — the denominator is tenants, not scanners.
    expect(m.activeOrgs).toBe(2);
    expect(m.value).toBeCloseTo((0.5 + 3 + 1.5) / 2, 6);
    expect(m.unpricedCalls).toBe(3);
  });

  it("returns null — not 0 — when nothing consumed inference in the window", async () => {
    fakePrisma({ scan: { findMany: vi.fn(async () => []) }, usageEvent: { groupBy: vi.fn(async () => []) } });
    expect(await avgLlmCostPerActiveOrg()).toBeNull();
  });
});
