// persistScanReport x the carry-forward PLAN (scan-carry-plan.ts): a rescan that KEEPS an in-progress
// claim open must leave that claim on the latest scan. Before the plan, within-noise and mock-scan keeps
// fell into the paired branch, were looked up by an old title nothing carried, and vanished with their
// assignee and lease. The fake tx below resolves findFirst against the rows scan.create actually wrote,
// so a lookup by the wrong title MISSES here as it would in Postgres.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ScanReport } from "@/lib/types";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: mockGetPrisma,
  withDb: (op: (c: unknown) => unknown) => op(undefined),
  withRetry: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/scans-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scans-read")>()),
  findScanByCommit: vi.fn(async () => null),
  findScanByScannedAt: vi.fn(async () => null),
  findScanByDedupKey: vi.fn(async () => null),
}));
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalOrgSlug: (slug: string) => slug.trim().toLowerCase(),
  canonicalRepoFullName: (owner: string, name: string) => `${owner}/${name}`.toLowerCase(),
  ensureOrgId: vi.fn(async () => "org_1"),
  withRepoLock: <T,>(_key: string, fn: () => Promise<T>) => fn(),
  upsertRacing: async <T,>(upsert: () => Promise<T>) => upsert(),
  isUniqueConstraintError: () => false,
}));
vi.mock("@/lib/cache", () => ({ cacheDelete: vi.fn(), makeCacheKey: vi.fn(() => "k") }));
vi.mock("@/lib/db/rec-transition-effects", () => ({ applyRecTransitionEffects: vi.fn(async () => ({ applied: [], failed: [] })) }));

import { persistScanReport } from "./scans-persist";

const LEASE = new Date("2026-10-23T12:00:00.000Z");
const DUE = new Date("2026-11-01T00:00:00.000Z");

const claimedRow = (over: Record<string, unknown> = {}) => ({
  id: "rec_ip", dimId: "D5", title: "Docs drift from the code", status: "in_progress",
  assigneeLogin: "octocat", targetDate: DUE, claimActor: "agent:lane", claimExecutor: "local", leaseUntil: LEASE, needsHuman: false,
  impact: "high", effort: "medium", rationale: "r", firstStep: "f", explore: "[]", levelUnlock: null, kind: "gap", craftAxis: null,
  ...over,
});

function fake(prev: { recs: unknown[]; dims: { dimId: string; score: number }[]; engineProvider: string }) {
  let carried: Array<Record<string, unknown>> = [];
  const copies: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const tx = {
    scan: {
      create: vi.fn(async ({ data }: { data: { recommendations: { create: Array<Record<string, unknown>> } } }) => {
        carried = data.recommendations.create;
        return { id: "scan_new" };
      }),
    },
    recommendation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        copies.push(data);
        return { id: `rec_copy_${copies.length}` };
      }),
      findFirst: vi.fn(async ({ where }: { where: { dimId: string; title: string } }) => {
        const j = carried.findIndex((r) => r.dimId === where.dimId && r.title === where.title);
        return j < 0 ? null : { id: `rec_new_${j}` };
      }),
    },
    recommendationEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return { id: "evt" };
      }),
    },
    repoContributor: { deleteMany: vi.fn(), createMany: vi.fn() },
    repoTeam: { deleteMany: vi.fn(), createMany: vi.fn() },
    aiChange: { upsert: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    repository: { upsert: vi.fn(async () => ({ id: "repo_1" })), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    scan: {
      findFirst: vi.fn(async () => ({
        recommendations: prev.recs, dimensions: prev.dims, engineProvider: prev.engineProvider, engineDegraded: false, rubricVersion: null,
      })),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  mockGetPrisma.mockReturnValue(prisma);
  return { carried: () => carried, copies, events };
}

function report(over: { roadmap: { dimension: string; title: string }[]; d5: number; resolved?: string[]; headSha?: string }): ScanReport {
  return {
    repo: { owner: "acme", name: "widget", url: "https://github.com/acme/widget", primaryLanguage: "TS", stars: 1, isPrivate: false, headSha: over.headSha ?? "sha_carry" },
    overallScore: 70, level: { id: "L3", name: "Practicing" }, archetype: "app", adoptionScore: 60, rigorScore: 80,
    posture: { id: "balanced" }, confidence: 0.9, engine: { provider: "anthropic", model: "claude" },
    headline: "ok", strengths: [], risks: [], discrepancies: [], contributors: [],
    dimensions: [{ id: "D5", name: "Docs", weight: 0.1, score: over.d5, signalScore: over.d5, llmScore: over.d5, summary: "", evidence: [], strengths: [], gaps: [] }],
    roadmap: over.roadmap.map((r) => ({ ...r, impact: "high", effort: "medium", rationale: "because", explore: [], levelUnlock: null })),
    ...(over.resolved ? { resolvedFollowUpIds: over.resolved } : {}),
    scannedAt: "2026-10-22T00:00:00.000Z",
  } as unknown as ScanReport;
}

const claimOnto = { status: "in_progress", assigneeLogin: "octocat", targetDate: DUE, claimActor: "agent:lane", claimExecutor: "local", leaseUntil: LEASE, needsHuman: false };

beforeEach(() => vi.clearAllMocks());

describe("persistScanReport - a kept in-progress claim survives the rescan", () => {
  it("within-noise (+2, real engines, not restated): copied forward as in_progress with its claim and a within-noise event", async () => {
    const f = fake({ recs: [claimedRow()], dims: [{ dimId: "D5", score: 60 }], engineProvider: "anthropic" });
    const res = await persistScanReport(report({ roadmap: [{ dimension: "D5", title: "A different docs gap" }], d5: 62, resolved: ["rec_ip"] }));

    expect(f.copies).toHaveLength(1);
    expect(f.copies[0]).toMatchObject({ scanId: "scan_new", title: "Docs drift from the code", ...claimOnto });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ recommendationId: "rec_copy_1", fromValue: "in_progress", toValue: "in_progress" });
    expect(String(f.events[0]!.note)).toMatch(/noise band/);
    // The other D5 gap is NOT handed the claim through tier 3, and nothing was closed.
    expect(f.carried()[0]).toMatchObject({ status: "open", leaseUntil: null, claimActor: null });
    expect(res?.closedFollowUpIds).toEqual([]);
  });

  it("mock-scan (previous scan on the mock floor, this one real): copied forward with the mock-scan note", async () => {
    const f = fake({ recs: [claimedRow()], dims: [{ dimId: "D5", score: 40 }], engineProvider: "mock" });
    await persistScanReport(report({ roadmap: [], d5: 80 }));

    expect(f.copies).toHaveLength(1);
    expect(f.copies[0]).toMatchObject({ title: "Docs drift from the code", ...claimOnto });
    expect(String(f.events[0]!.note)).toMatch(/mock floor/);
    expect(f.events[0]).toMatchObject({ recommendationId: "rec_copy_1" });
  });

  it("claimed-but-restated under a normalized title: the event lands on the NEW row by its roadmap index", async () => {
    const f = fake({ recs: [claimedRow({ title: "Add CI lint" })], dims: [{ dimId: "D5", score: 60 }], engineProvider: "anthropic" });
    await persistScanReport(
      report({ roadmap: [{ dimension: "D5", title: "Unrelated first" }, { dimension: "D5", title: "add CI lint." }], d5: 70, resolved: ["rec_ip"] }),
    );

    expect(f.carried()[1]).toMatchObject({ title: "add CI lint.", ...claimOnto });
    expect(f.copies).toHaveLength(0);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ recommendationId: "rec_new_1", toValue: "in_progress" });
    expect(String(f.events[0]!.note)).toMatch(/Claimed resolved by commit trailer/);
  });

  it("closedFollowUpIds is exactly the ids the plan resolved, and a done copy drops the claim", async () => {
    const f = fake({
      recs: [claimedRow(), claimedRow({ id: "rec_kept", title: "Kept one", dimId: "D9" })],
      dims: [{ dimId: "D5", score: 50 }],
      engineProvider: "anthropic",
    });
    const res = await persistScanReport(report({ roadmap: [{ dimension: "D9", title: "Kept one" }], d5: 70, resolved: ["rec_ip", "rec_kept"] }));

    expect(res?.closedFollowUpIds).toEqual(["rec_ip"]);
    expect(f.copies[0]).toMatchObject({ status: "done", assigneeLogin: "octocat", claimActor: null, leaseUntil: null, claimExecutor: null, needsHuman: false });
  });
});
