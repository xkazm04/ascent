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

// ── HIGH: head-pointer recency guard (replaces the hollow "exercised by e2e" claim) ───────────────
//
// The repo's head pointer (headSha / headEtag / lastScanAt) is the conditional-re-scan freshness
// reference: the next re-scan sends `If-None-Match` from headEtag and shows "up to date" from
// lastScanAt. The persist layer advances it through a SINGLE `repository.updateMany` carrying a
// recency-guarded `where` — `OR:[{lastScanAt:null},{lastScanAt:{lt:scannedAtDate}}]` — so the row
// only ever moves FORWARD. The source comment (scans-persist.ts:81-84) documents a previously-shipped
// data-corruption bug where the head was written unconditionally, letting a delayed/replayed scan of
// an OLDER commit roll headSha back and tear it apart from headEtag. These tests PIN that fix: the
// guard predicate is always present (so an older scan is a structural no-op), headSha+headEtag move
// TOGETHER on a newer scan, and the report read returns the head — the latest — not an older row.
describe("persistScanReport — head-pointer recency guard (advance-on-newer, hold-on-older)", () => {
  /** Grab the single head-advance updateMany call args (the one carrying the lastScanAt recency OR). */
  function headAdvanceCall(prisma: ReturnType<typeof fakePrisma>["prisma"]) {
    const calls = prisma.repository.updateMany.mock.calls as Array<
      [{ where: { id: string; OR: Array<Record<string, unknown>> }; data: Record<string, unknown> }]
    >;
    const headCall = calls.find((c) => Array.isArray(c[0]?.where?.OR));
    expect(headCall, "expected a recency-guarded head-advance updateMany").toBeDefined();
    return headCall![0];
  }

  it("HEAD ADVANCES ON NEWER: the update is gated on lastScanAt < scannedAt and moves headSha+headEtag together", async () => {
    const { prisma } = fakePrisma({ previousRecs: null });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null); // new sha → full persist runs

    const scannedAt = "2026-06-19T00:00:00.000Z";
    await persistScanReport(
      makeReport({ headSha: "sha_newer", scannedAt }),
      { headEtag: 'W/"etag-newer"' },
    );

    const { where, data } = headAdvanceCall(prisma);
    // The guard predicate must be present so a newer scan advances but an older one can't — the exact
    // clause whose loss (regressing to an unconditional update) re-opens the head-rollback bug.
    expect(where.id).toBe("repo_1");
    expect(where.OR).toEqual([
      { lastScanAt: null },
      { lastScanAt: { lt: new Date(scannedAt) } },
    ]);
    // headSha + headEtag advance TOGETHER in the same write (so they can't tear apart), with the new
    // lastScanAt — the head pointer now references the just-persisted newer scan.
    expect(data).toMatchObject({
      lastScanAt: new Date(scannedAt),
      headSha: "sha_newer",
      headEtag: 'W/"etag-newer"',
    });
  });

  it("HEAD HOLDS ON OLDER: an out-of-order older scan's head-advance is a DB no-op (the latest stays latest)", async () => {
    // The DB enforces the recency guard: for an OLDER scan the OR predicate matches no row, so
    // updateMany affects 0 rows and the stored head (a newer commit) is NOT moved backward. Model that
    // by having updateMany report count:0 for this older replay.
    const { prisma } = fakePrisma({ previousRecs: null });
    prisma.repository.updateMany.mockResolvedValue({ count: 0 }); // older scan → guard matches nothing
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null);

    const olderScannedAt = "2026-01-01T00:00:00.000Z"; // earlier than an already-stored newer head
    const res = await persistScanReport(
      makeReport({ headSha: "sha_older", scannedAt: olderScannedAt }),
      { headEtag: 'W/"etag-older"' },
    );

    // The head-advance still carries the recency guard, and because it matched 0 rows the stored head
    // pointer is untouched — no rollback of headSha/headEtag/lastScanAt to the older commit.
    const { where } = headAdvanceCall(prisma);
    expect(where.OR).toEqual([
      { lastScanAt: null },
      { lastScanAt: { lt: new Date(olderScannedAt) } },
    ]);
    expect(prisma.repository.updateMany).toHaveResolvedWith({ count: 0 });
    expect(res?.headSha).toBe("sha_older"); // the scan still records its own sha; the repo head did not roll back
  });

  it("REPORT READ RETURNS THE HEAD (latest), not an older row: dedup reuses the head scan for the head commit", async () => {
    // The dedup read keys on the repo's head commit — re-persisting the head sha resolves to the
    // existing HEAD scan, never an older one. This is the read-side of the recency invariant: the
    // returned scan is the latest pinned to the head commit.
    const { prisma, scanCreate } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue({ id: "scan_head" }); // findScanByCommit returns the head row

    const res = await persistScanReport(makeReport({ headSha: "sha_head" }));

    expect(mockFindScanByCommit).toHaveBeenCalledWith("repo_1", "sha_head");
    expect(res).toMatchObject({ scanId: "scan_head", deduped: true, headSha: "sha_head" });
    expect(scanCreate).not.toHaveBeenCalled(); // no new row — the head scan is the report read result
  });

  it("a null/absent headEtag leaves the stored etag alone (advances lastScanAt only)", async () => {
    // A private /token scan carries no public ETag; the head-advance must not null out the stored one.
    const { prisma } = fakePrisma({ previousRecs: null });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByCommit.mockResolvedValue(null);

    const scannedAt = "2026-06-19T12:00:00.000Z";
    await persistScanReport(makeReport({ headSha: "sha_noetag", scannedAt })); // no headEtag opt

    const { data } = headAdvanceCall(prisma);
    expect(data).toMatchObject({ lastScanAt: new Date(scannedAt), headSha: "sha_noetag" });
    expect(data).not.toHaveProperty("headEtag"); // untouched, not reset to null
  });
});

// ── MEDIUM: sha-less findScanByScannedAt dedup fallback (edge-case hardening) ──────────────────────
//
// A report with NO resolvable commit SHA can't dedup by commit, so persist falls back to matching the
// existing scan by the report's own `scannedAt` (scans-persist.ts:149-159). This is the ONLY guard
// stopping a sha-less re-persist — a coalesced follower, a double-submit, a retried lane — from
// inserting a SECOND metered Scan row. The source itself flags equality-on-timestamp as "inherently
// fragile", which is exactly why the branch needs pinning: that findScanByScannedAt is the lookup the
// fallback keys on (not findScanByCommit), that a hit reuses the existing id with deduped:true +
// headSha:null and writes NO new row, that a miss persists exactly one new sha-less row (deduped:false),
// and that a non-finite/invalid scannedAt flows through as an Invalid Date without crashing the persist.
describe("persistScanReport — sha-less findScanByScannedAt dedup fallback", () => {
  it("keys the fallback on findScanByScannedAt (NOT findScanByCommit) for a sha-less report", async () => {
    // The branch selector: with no headSha the commit-dedup lookup must be skipped entirely and the
    // scannedAt fallback consulted instead — inverting this guard re-enables duplicate sha-less rows.
    const { prisma } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByScannedAt.mockResolvedValue({ id: "scan_sameTime" });

    const scannedAt = "2026-06-18T08:30:00.000Z";
    await persistScanReport(makeReport({ headSha: null, scannedAt }));

    // The fallback is consulted with the repo id and the report's own scannedAt (as a Date), and the
    // commit-dedup path is never touched for a sha-less report.
    expect(mockFindScanByScannedAt).toHaveBeenCalledTimes(1);
    expect(mockFindScanByScannedAt).toHaveBeenCalledWith("repo_1", new Date(scannedAt));
    expect(mockFindScanByCommit).not.toHaveBeenCalled();
  });

  it("HIT: a same-scannedAt row is reused (deduped:true, headSha:null) and NO new Scan row is created", async () => {
    // The load-bearing dedup invariant: a re-persist of the SAME sha-less report must reuse the first
    // row — zero new metered rows, no carry-forward read reached.
    const { prisma, scanCreate } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByScannedAt.mockResolvedValue({ id: "scan_first" });

    const res = await persistScanReport(makeReport({ headSha: null }));

    expect(res).toMatchObject({ scanId: "scan_first", deduped: true, headSha: null });
    expect(scanCreate).not.toHaveBeenCalled(); // no duplicate sha-less metered row
    expect(prisma.scan.findFirst).not.toHaveBeenCalled(); // short-circuited before carry-forward
  });

  it("MISS: a genuinely new sha-less report persists EXACTLY ONE row (deduped:false, headSha:null)", async () => {
    // No prior row at this scannedAt → the fallback must NOT suppress a genuinely-new sha-less scan;
    // it persists once and the stored scan's headSha stays null.
    const { prisma, scanCreate, createdScans } = fakePrisma({ previousRecs: null });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByScannedAt.mockResolvedValue(null); // never persisted before

    const res = await persistScanReport(makeReport({ headSha: null }));

    expect(scanCreate).toHaveBeenCalledTimes(1); // exactly one new row, not zero and not two
    expect(res).toMatchObject({ scanId: "scan_new", deduped: false, headSha: null });
    expect(createdScans[0]).toMatchObject({ headSha: null }); // the persisted row carries no sha
  });

  it("INVALID scannedAt: a non-date timestamp flows through as an Invalid Date without crashing", async () => {
    // A reconstructed/legacy sha-less report can carry a garbage scannedAt. `new Date(report.scannedAt)`
    // yields an Invalid Date (getTime()===NaN) rather than throwing, so the fallback is still consulted
    // — the persist must not blow up, and on a miss it still writes exactly one row.
    const { prisma, scanCreate } = fakePrisma({ previousRecs: null });
    mockGetPrisma.mockReturnValue(prisma);
    mockFindScanByScannedAt.mockResolvedValue(null);

    const res = await persistScanReport(makeReport({ headSha: null, scannedAt: "not-a-date" }));

    // The fallback received an Invalid Date (NaN time) and no crash propagated.
    expect(mockFindScanByScannedAt).toHaveBeenCalledTimes(1);
    const [, passedDate] = mockFindScanByScannedAt.mock.calls[0] as [string, Date];
    expect(passedDate).toBeInstanceOf(Date);
    expect(Number.isNaN(passedDate.getTime())).toBe(true);
    expect(scanCreate).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ deduped: false, headSha: null });
  });
});
