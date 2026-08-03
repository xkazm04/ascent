// getOrgBacklog's QUERY PLAN, pinned. The aggregation contract lives next door in
// org-insights-backlog.test.ts; this file exists because the two properties that keep the org backlog
// affordable at fleet scale are invisible from both the UI and the returned object.
//
// The measurement behind them is in getOrgBacklog's header. Short version: the obvious nested shape
// (repository → scans take 1 → recommendations → events take 1) is NOT an N+1 — Prisma's client-side
// query compiler already flattens each level into one `IN (…)` statement. What it does NOT do is push
// a nested `take` (or `distinct`) into SQL, so `scans: { take: 1 }` transfers the org's ENTIRE scan
// history and `events: { take: 1 }` transfers every event ever written, just to keep one row each.
// Measured at 300 repos × 60 scans × 8 events/rec: 48,000 rows / ~1.3–3.3s, versus 9,600 rows / ~0.7–0.9s
// for the groupBy-based plan below.
//
// So two things must hold, and neither one fails visibly:
//   1. the number of queries is CONSTANT in fleet size (a per-repo fan-out would still return correct
//      data — just one query per repo);
//   2. no read reintroduces a nested relation `take`, and the "latest per group" picks stay `groupBy`
//      + `_max` (a real SQL GROUP BY), so row volume tracks what the page renders rather than how long
//      the org has been scanning.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import { getOrgBacklog } from "./org-insights";

type Args = Record<string, unknown>;

/**
 * A prisma double that RECORDS every delegate call — model, method, and args — so the plan can be
 * asserted rather than the payload. Serves a synthetic fleet of `repos` repositories, each with one
 * latest scan carrying `recsPerRepo` recommendations.
 */
function recordingPrisma(repos: number, recsPerRepo: number) {
  const calls: { model: string; method: string; args: Args }[] = [];
  const record = <T>(model: string, method: string, produce: (args: Args) => T) =>
    vi.fn(async (args: Args = {}) => {
      calls.push({ model, method, args });
      return produce(args);
    });

  const repoIds = Array.from({ length: repos }, (_, i) => `repo_${i}`);
  const recIds = repoIds.flatMap((_, i) => Array.from({ length: recsPerRepo }, (_, j) => `rec_${i}_${j}`));
  const scannedAt = new Date("2026-06-14T00:00:00Z");

  const client = {
    organization: { findUnique: record("organization", "findUnique", () => ({ id: "org_1", slug: "acme" })) },
    repository: {
      findMany: record("repository", "findMany", () =>
        repoIds.map((id, i) => ({ id, fullName: `acme/r${i}`, name: `r${i}` })),
      ),
    },
    scan: {
      groupBy: record("scan", "groupBy", () => repoIds.map((repoId) => ({ repoId, _max: { scannedAt } }))),
      findMany: record("scan", "findMany", () =>
        repoIds.map((repoId, i) => ({ id: `scan_${i}`, repoId, archetype: "library" })),
      ),
    },
    scanDimension: { findMany: record("scanDimension", "findMany", () => []) },
    recommendation: {
      findMany: record("recommendation", "findMany", () =>
        recIds.map((id) => ({
          id,
          scanId: `scan_${id.split("_")[1]}`,
          title: id,
          dimId: "D1",
          impact: "medium",
          effort: "medium",
          rationale: "",
          explore: "[]",
          status: "open",
          assigneeLogin: null,
          targetDate: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        })),
      ),
    },
    recommendationEvent: {
      groupBy: record("recommendationEvent", "groupBy", () =>
        recIds.map((recommendationId) => ({ recommendationId, _max: { createdAt: scannedAt } })),
      ),
    },
    repoContributor: { findMany: record("repoContributor", "findMany", () => [{ login: "alice" }]) },
  };
  return { calls, client };
}

/** Deep search for a relation `take` — the exact construct that makes row volume unbounded. */
function hasNestedTake(node: unknown, atRoot = true): boolean {
  if (node == null || typeof node !== "object") return false;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "take" && !atRoot) return true;
    if (hasNestedTake(v, false)) return true;
  }
  return false;
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgBacklog — query plan", () => {
  it("issues the same number of queries for 300 repos as for 1 — no per-repo fan-out", async () => {
    const small = recordingPrisma(1, 3);
    mockGetPrisma.mockReturnValue(small.client);
    await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z"));

    const large = recordingPrisma(300, 10);
    mockGetPrisma.mockReturnValue(large.client);
    await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z"));

    // 1 org lookup + 7 reads. Constant: a 300× bigger fleet buys zero extra round trips.
    expect(small.calls).toHaveLength(8);
    expect(large.calls).toHaveLength(small.calls.length);
    expect(large.calls.map((c) => `${c.model}.${c.method}`)).toEqual(
      small.calls.map((c) => `${c.model}.${c.method}`),
    );
  });

  it("reads each model exactly once — no repeated sweep of the same table", async () => {
    const fake = recordingPrisma(50, 6);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z"));

    const perTarget = new Map<string, number>();
    for (const c of fake.calls) perTarget.set(`${c.model}.${c.method}`, (perTarget.get(`${c.model}.${c.method}`) ?? 0) + 1);
    expect([...perTarget.entries()].filter(([, n]) => n > 1)).toEqual([]);
    expect([...perTarget.keys()].sort()).toEqual([
      "organization.findUnique",
      "recommendation.findMany",
      "recommendationEvent.groupBy",
      "repoContributor.findMany",
      "repository.findMany",
      "scan.findMany",
      "scan.groupBy",
      "scanDimension.findMany",
    ]);
  });

  it("takes BOTH 'latest per group' picks with groupBy + _max, not a nested take", async () => {
    const fake = recordingPrisma(20, 4);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z"));

    // Latest scan per repo: a real SQL GROUP BY, so the org's scan HISTORY never crosses the wire.
    const scanGroup = fake.calls.find((c) => c.model === "scan" && c.method === "groupBy")!;
    expect(scanGroup.args.by).toEqual(["repoId"]);
    expect(scanGroup.args._max).toEqual({ scannedAt: true });

    // Last activity per recommendation: likewise one row per rec, not every event ever written.
    const eventGroup = fake.calls.find((c) => c.model === "recommendationEvent")!;
    expect(eventGroup.method).toBe("groupBy");
    expect(eventGroup.args.by).toEqual(["recommendationId"]);
    expect(eventGroup.args._max).toEqual({ createdAt: true });
  });

  it("carries no nested relation `take` on any read", async () => {
    const fake = recordingPrisma(20, 4);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z"));

    for (const c of fake.calls) {
      expect([`${c.model}.${c.method}`, hasNestedTake(c.args)]).toEqual([`${c.model}.${c.method}`, false]);
    }
  });

  it("scopes every read to the org (and its segment/stack slice) — never a bare fleet-wide sweep", async () => {
    const fake = recordingPrisma(20, 4);
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgBacklog("acme", "seg_1", new Date("2026-06-15T12:00:00Z"), "grp_1");

    const scoped = { orgId: "org_1", segments: { some: { segmentId: "seg_1" } }, techGroups: { some: { groupId: "grp_1" } } };
    const repoRead = fake.calls.find((c) => c.model === "repository")!;
    expect(repoRead.args.where).toEqual(scoped);
    // The scan groupBy scopes THROUGH the relation rather than an id list — that is what lets it run in
    // parallel with the repository read instead of waiting on it.
    const scanGroup = fake.calls.find((c) => c.model === "scan" && c.method === "groupBy")!;
    expect(scanGroup.args.where).toEqual({ repo: scoped });
    const contributors = fake.calls.find((c) => c.model === "repoContributor")!;
    expect(contributors.args.where).toEqual({ repo: scoped });
  });

  it("skips the downstream reads entirely when the fleet has no scans", async () => {
    const fake = recordingPrisma(0, 0);
    mockGetPrisma.mockReturnValue(fake.client);
    const b = (await getOrgBacklog("acme", null, new Date("2026-06-15T12:00:00Z")))!;

    expect(b.tracked).toBe(0);
    // No scans → no scan.findMany, no dimension/recommendation/event reads. Only the three wave-1 reads.
    expect(fake.calls.map((c) => `${c.model}.${c.method}`).sort()).toEqual([
      "organization.findUnique",
      "repoContributor.findMany",
      "repository.findMany",
      "scan.groupBy",
    ]);
  });
});
