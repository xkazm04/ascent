// persistScanReport — the two CRITICAL business invariants that gate billing and tracking state:
//
//  1. COMMIT-SHA DEDUP (billing): re-persisting the SAME head commit must REUSE the existing Scan
//     row and create NO second (metered) row — `deduped:true`, `scan.create` never called. A genuinely
//     new sha persists exactly one new row (`deduped:false`). The cross-instance P2002 backstop reuses
//     the winner; with no winner it re-throws.
//  2. CARRY-FORWARD (tracking state): a re-scan must PRESERVE a prior recommendation's
//     status / assigneeLogin / targetDate (matched through the tiered `matchRecommendations`, which is
//     kept REAL here), and must default a brand-new (unmatched) roadmap item to open / null / null.
//
// All DB seams are faked: client (withDb/withRetry/getPrisma/isDbConfigured), scans-read (the two
// dedup lookups), scans-shared (org-id, repo-lock, upsert-race, P2002 classifier), and cache. The real
// matcher + real Prisma error class stay in to assert BEHAVIOR, not implementation coupling.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { ScanReport } from "@/lib/types";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

const { mockFindScanByCommit, mockFindScanByScannedAt } = vi.hoisted(() => ({
  mockFindScanByCommit: vi.fn(),
  mockFindScanByScannedAt: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  // Pass-throughs: the persist body's correctness, not the retry/token-refresh wrappers, is under test.
  withDb: (op: (c: unknown) => unknown) => op(undefined),
  withRetry: (fn: () => unknown) => fn(),
}));

vi.mock("@/lib/db/scans-read", () => ({
  findScanByCommit: mockFindScanByCommit,
  findScanByScannedAt: mockFindScanByScannedAt,
}));

// Keep the concurrency primitives inert + transparent so the dedup/carry-forward decision is exercised
// directly. `withRepoLock` just runs the fn; `upsertRacing` runs the upsert; `isUniqueConstraintError`
// uses the real P2002 classification (the persist path's cross-instance backstop depends on it).
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  ensureOrgId: vi.fn(async () => "org_1"),
  withRepoLock: <T,>(_key: string, fn: () => Promise<T>) => fn(),
  upsertRacing: async <T,>(upsert: () => Promise<T>) => upsert(),
  isUniqueConstraintError: (err: unknown) =>
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
}));

// Cache eviction is a best-effort side effect; make it a no-op so it never touches the assertions.
vi.mock("@/lib/cache", () => ({
  cacheDelete: vi.fn(),
  makeCacheKey: vi.fn(() => "k"),
}));

import { persistScanReport } from "./scans-persist";

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

type PrevRec = {
  dimId: string;
  title: string;
  status: string;
  assigneeLogin: string | null;
  targetDate: Date | null;
};

/**
 * A fake prisma covering exactly the calls persistScanReport makes after dedup:
 *  - repository.upsert (seed/refresh repo) → returns { id }
 *  - repository.updateMany (head-pointer advance) → no-op
 *  - scan.findFirst (carry-forward "previous" read) → returns prior recommendations (or null)
 *  - $transaction(fn) → runs fn against a tx that records the scan.create payload
 * `createdScans` captures every scan.create `data` so tests can assert the carried rec fields, and
 * `scanCreateCalls` counts them so the dedup tests can assert ZERO new metered rows.
 */
function fakePrisma(opts: {
  previousRecs?: PrevRec[] | null;
  /** Make the in-tx scan.create throw this on its first call (cross-instance P2002 race). */
  scanCreateThrows?: unknown;
} = {}) {
  const createdScans: Array<Record<string, unknown>> = [];
  const scanCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (opts.scanCreateThrows !== undefined && scanCreate.mock.calls.length === 1) {
      throw opts.scanCreateThrows;
    }
    createdScans.push(data);
    return { id: "scan_new" };
  });

  const tx = {
    scan: { create: scanCreate },
    repoContributor: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
    repoTeam: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
    auditLog: { create: vi.fn(async () => ({})) },
  };

  const prisma = {
    repository: {
      upsert: vi.fn(async () => ({ id: "repo_1" })),
      update: vi.fn(async () => ({ id: "repo_1" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    scan: {
      findFirst: vi.fn(async () => {
        const recs = opts.previousRecs;
        return recs ? { recommendations: recs } : null;
      }),
    },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };

  return { prisma, scanCreate, createdScans, tx };
}

/** A minimal-but-real-shaped ScanReport; `roadmap` carries the rec identities matchRecommendations sees. */
function makeReport(over: {
  headSha?: string | null;
  scannedAt?: string;
  roadmap?: Array<{ dimension: string; title: string }>;
} = {}): ScanReport {
  const roadmap = (over.roadmap ?? [{ dimension: "D1", title: "Add CI smoke tests" }]).map((r) => ({
    dimension: r.dimension,
    title: r.title,
    impact: "high",
    effort: "medium",
    rationale: "because",
    explore: [],
    levelUnlock: null,
  }));
  return {
    repo: {
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      primaryLanguage: "TypeScript",
      stars: 5,
      isPrivate: false,
      headSha: over.headSha === undefined ? "sha_abc" : over.headSha,
    },
    overallScore: 70,
    level: { id: "L3", name: "Practicing" },
    archetype: "app",
    adoptionScore: 60,
    rigorScore: 80,
    posture: { id: "balanced" },
    confidence: 0.9,
    engine: { provider: "anthropic", model: "claude" },
    headline: "ok",
    strengths: [],
    risks: [],
    discrepancies: [],
    dimensions: [],
    contributors: [],
    roadmap,
    scannedAt: over.scannedAt ?? "2026-06-18T00:00:00.000Z",
  } as unknown as ScanReport;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockFindScanByCommit.mockReset();
  mockFindScanByScannedAt.mockReset();
});

// ── CRITICAL #1: commit-SHA dedup gates billing ──────────────────────────────────────────────────

describe("persistScanReport — commit-SHA dedup (no second metered Scan row)", () => {
  it("re-persisting the SAME sha returns deduped:true and never calls scan.create", async () => {
    const { prisma, scanCreate } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    // A scan for this exact commit already exists → the dedup branch must short-circuit.
    mockFindScanByCommit.mockResolvedValue({ id: "scan_existing" });

    const res = await persistScanReport(makeReport({ headSha: "sha_abc" }));

    expect(res).toMatchObject({ scanId: "scan_existing", deduped: true, headSha: "sha_abc" });
    expect(scanCreate).not.toHaveBeenCalled(); // load-bearing: zero new metered rows
    expect(prisma.scan.findFirst).not.toHaveBeenCalled(); // didn't even reach carry-forward
  });

  it("a genuinely NEW sha persists exactly one Scan row and returns deduped:false", async () => {
    const { prisma, scanCreate } = fakePrisma({ previousRecs: null });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null); // never scored before

    const res = await persistScanReport(makeReport({ headSha: "sha_new" }));

    expect(scanCreate).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ scanId: "scan_new", deduped: false, headSha: "sha_new" });
  });

  it("sha-less report dedups on scannedAt: an existing same-time row reuses it, no scan.create", async () => {
    const { prisma, scanCreate } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByScannedAt.mockResolvedValue({ id: "scan_sameTime" });

    const res = await persistScanReport(makeReport({ headSha: null }));

    expect(res).toMatchObject({ scanId: "scan_sameTime", deduped: true, headSha: null });
    expect(scanCreate).not.toHaveBeenCalled();
    expect(mockFindScanByScannedAt).toHaveBeenCalledTimes(1);
  });

  it("cross-instance P2002 race: re-reads the winner and dedups (no duplicate row, error swallowed)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "x",
    });
    const { prisma, scanCreate } = fakePrisma({ previousRecs: null, scanCreateThrows: p2002 });
    mockGetPrisma.mockReturnValue(prisma);
    // First dedup read misses (our read-then-insert path), then after the P2002 the winner is found.
    mockFindScanByCommit.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "scan_winner" });

    const res = await persistScanReport(makeReport({ headSha: "sha_race" }));

    expect(scanCreate).toHaveBeenCalledTimes(1); // attempted once, rejected by the unique constraint
    expect(res).toMatchObject({ scanId: "scan_winner", deduped: true, headSha: "sha_race" });
  });

  it("P2002 with no recoverable winner re-throws (does not silently swallow data loss)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "x",
    });
    const { prisma } = fakePrisma({ previousRecs: null, scanCreateThrows: p2002 });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValueOnce(null).mockResolvedValueOnce(null); // no winner ever appears

    await expect(persistScanReport(makeReport({ headSha: "sha_race" }))).rejects.toBe(p2002);
  });

  it("returns null and writes nothing when persistence is disabled", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await persistScanReport(makeReport());
    expect(res).toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });
});

// ── CRITICAL #2: carry-forward preserves tracked recommendation state ─────────────────────────────

describe("persistScanReport — carry-forward of recommendation tracking state", () => {
  /** Pull the recommendations.create rows out of the captured scan.create payload. */
  function createdRecs(createdScans: Array<Record<string, unknown>>) {
    const data = createdScans[0] as {
      recommendations: { create: Array<Record<string, unknown>> };
    };
    return data.recommendations.create;
  }

  it("PRESERVES status/assigneeLogin/targetDate from the matched prior rec (exact-title match)", async () => {
    const due = new Date("2026-09-01T00:00:00.000Z");
    const { prisma, createdScans } = fakePrisma({
      previousRecs: [
        {
          dimId: "D1",
          title: "Add CI smoke tests",
          status: "in_progress",
          assigneeLogin: "octocat",
          targetDate: due,
        },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null); // new sha → goes through carry-forward

    await persistScanReport(
      makeReport({ headSha: "sha_v2", roadmap: [{ dimension: "D1", title: "Add CI smoke tests" }] }),
    );

    const recs = createdRecs(createdScans);
    expect(recs).toHaveLength(1);
    // The exact carried-field copy — the invariant the re-scan must never reset to defaults.
    expect(recs[0]).toMatchObject({
      title: "Add CI smoke tests",
      dimId: "D1",
      status: "in_progress",
      assigneeLogin: "octocat",
      targetDate: due,
    });
  });

  it("carries state even when the LLM REPHRASED the title (tier-2 normalized match)", async () => {
    const due = new Date("2026-10-15T00:00:00.000Z");
    const { prisma, createdScans } = fakePrisma({
      previousRecs: [
        {
          dimId: "D2",
          title: "Add CI smoke tests.",
          status: "done",
          assigneeLogin: "maintainer",
          targetDate: due,
        },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null);

    // Rephrased: trailing punctuation / casing differs — only the tiered matcher pairs these.
    await persistScanReport(
      makeReport({ headSha: "sha_v2", roadmap: [{ dimension: "D2", title: "add CI smoke tests" }] }),
    );

    const recs = createdRecs(createdScans);
    expect(recs[0]).toMatchObject({
      status: "done",
      assigneeLogin: "maintainer",
      targetDate: due,
    });
  });

  it("defaults a brand-new (unmatched) roadmap item to open / null / null", async () => {
    const { prisma, createdScans } = fakePrisma({
      previousRecs: [
        {
          dimId: "D1",
          title: "Add CI smoke tests",
          status: "in_progress",
          assigneeLogin: "octocat",
          targetDate: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null);

    // A roadmap item on a DIFFERENT dimension/title with no prior counterpart.
    await persistScanReport(
      makeReport({
        headSha: "sha_v2",
        roadmap: [
          { dimension: "D1", title: "Add CI smoke tests" }, // matches prior → carries
          { dimension: "D7", title: "Adopt trunk-based development" }, // new → defaults
        ],
      }),
    );

    const recs = createdRecs(createdScans);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ status: "in_progress", assigneeLogin: "octocat" });
    expect(recs[1]).toMatchObject({
      title: "Adopt trunk-based development",
      status: "open",
      assigneeLogin: null,
      targetDate: null,
    });
  });

  it("carried state lands on the recommendation at the SAME roadmap index (no desync)", async () => {
    const { prisma, createdScans } = fakePrisma({
      previousRecs: [
        { dimId: "D1", title: "First", status: "open", assigneeLogin: null, targetDate: null },
        { dimId: "D2", title: "Second", status: "done", assigneeLogin: "bob", targetDate: null },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null);

    // Reverse the order in the new roadmap; carried state must still follow identity, not position.
    await persistScanReport(
      makeReport({
        headSha: "sha_v2",
        roadmap: [
          { dimension: "D2", title: "Second" },
          { dimension: "D1", title: "First" },
        ],
      }),
    );

    const recs = createdRecs(createdScans);
    expect(recs[0]).toMatchObject({ title: "Second", status: "done", assigneeLogin: "bob" });
    expect(recs[1]).toMatchObject({ title: "First", status: "open", assigneeLogin: null });
  });
});
