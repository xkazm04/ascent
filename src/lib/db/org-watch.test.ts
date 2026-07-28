// Pins the two money/fairness invariants of the autoscan scheduler heart (org-watch.ts):
//
//   • claimRescan is a CAS (compare-and-set): it advances nextScanAt ONLY while the repo is still
//     due (the conditional updateMany WHERE), and reports success iff `res.count === 1`. Two
//     overlapping cron passes therefore can't both win — the DB serializes the update, the first
//     flips the repo out of the due window, and the loser's updateMany matches 0 rows → false. A
//     regression to `count >= 1` / `> 0` would let an already-claimed (0-row) update still report
//     a win, reopening the double-scan / double-bill the guard exists to prevent.
//
//   • listDueRescans interleaves due repos ROUND-ROBIN across orgs so one large fleet sitting at
//     the front of the oldest-due queue can't starve every other org in a single cron pass — while
//     still respecting `limit` and preferring the most-overdue repo within each org.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

// org-watch imports segmentScope from org-shared (used by setWatchedSchedule, not the funcs under
// test). Stub it so the import graph resolves without pulling the real module / a DB client.
// getOrgBySlug backs getOrgId (used by recordConformance below) — resolve every slug to org_1.
vi.mock("@/lib/db/org-shared", () => ({
  segmentScope: () => ({}),
  getOrgBySlug: vi.fn(async () => ({ id: "org_1" })),
}));

import { advanceToFullCadence, claimRescan, listDueRescans, recordConformance, reconcileListedRepos } from "./org-watch";
import { verifyAudit } from "./audit-integrity";

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

// ── claimRescan: the compare-and-set / claim-once guard ─────────────────────────────────────

describe("claimRescan CAS contract (claim-once, count===1)", () => {
  it("returns true ONLY when the conditional updateMany matched exactly one due row (count===1)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    const won = await claimRescan("repo_1", "weekly");

    expect(won).toBe(true);
    // The claim is conditional: it advances the repo only WHILE it is still due — watched, scheduled,
    // and nextScanAt already in the past. That WHERE is exactly what makes the update lose for a repo a
    // concurrent pass already advanced (it no longer matches → count 0). Pin the gate so a regression
    // that drops watched / not-off / lte(now) can't silently claim a non-due (or off) repo.
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]![0] as {
      where: { id: string; watched: boolean; scanSchedule: { not: string }; nextScanAt: { lte: Date } };
      data: { nextScanAt: Date };
    };
    expect(arg.where.id).toBe("repo_1");
    expect(arg.where.watched).toBe(true);
    expect(arg.where.scanSchedule).toEqual({ not: "off" });
    expect(arg.where.nextScanAt.lte).toBeInstanceOf(Date);
    expect(arg.data.nextScanAt).toBeInstanceOf(Date); // advanced to the next cadence on a win
  });

  it("returns false when the conditional updateMany matched 0 rows (the repo was already claimed)", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    // This IS the loser of an overlapping cron race: the winner already advanced nextScanAt out of the
    // due window, so this conditional update matches nothing. It must NOT report a claim.
    expect(await claimRescan("repo_1", "weekly")).toBe(false);
  });

  it("treats only count===1 as a win — a (degenerate) multi-row match is NOT a claim", async () => {
    // Guards the literal `res.count === 1`. A regression to `>= 1` / `> 0` would report a win here and
    // also turn the 0-row loser above into a false win — defeating the cross-instance double-bill guard.
    const updateMany = vi.fn(async () => ({ count: 2 }));
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    expect(await claimRescan("repo_1", "weekly")).toBe(false);
  });

  it("two concurrent claims of the same repo: exactly one wins (CAS — second sees 0 rows)", async () => {
    // The single source of truth is the live row's due-state. Model it: the FIRST conditional update to
    // run flips the repo out of the due window; every later update matches 0 rows. Exactly one true.
    let stillDue = true;
    const updateMany = vi.fn(async () => {
      if (stillDue) {
        stillDue = false; // DB-serialized: the first winner advances nextScanAt past now
        return { count: 1 };
      }
      return { count: 0 };
    });
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    const [a, b] = await Promise.all([claimRescan("repo_1", "weekly"), claimRescan("repo_1", "weekly")]);

    expect([a, b].filter(Boolean)).toHaveLength(1); // claim-once: never both, never neither
    expect(updateMany).toHaveBeenCalledTimes(2); // both callers attempted the conditional update
  });

  it('an "off" / unknown schedule is not claimable and never touches the DB', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    // nextScanFor("off") === null → short-circuit BEFORE any write (listDueRescans also excludes "off").
    expect(await claimRescan("repo_1", "off")).toBe(false);
    expect(await claimRescan("repo_1", "bogus")).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns false (no DB call) when persistence is unconfigured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await claimRescan("repo_1", "weekly")).toBe(false);
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  // ── cadence arithmetic (G3-13): "monthly" is a calendar month, not a flat 30 days ───────────────
  //
  // advanceToFullCadence is the settle-after-a-successful-scan step, so the date it writes IS the
  // repo's next autoscan slot (and what the dashboard shows). A flat 30-day step walked a "monthly"
  // repo backwards through the calendar — the 31st → the 30th → the 29th … — firing 12.2 times a year
  // instead of 12, on a date that drifts every month.
  describe("advanceToFullCadence — cadence arithmetic", () => {
    /** Run advanceToFullCadence at a frozen clock and return the nextScanAt it wrote. */
    async function advancedAt(nowIso: string, schedule: string): Promise<Date> {
      const update = vi.fn(async () => ({ id: "repo_1" }));
      mockGetPrisma.mockReturnValue({ repository: { update } });
      vi.useFakeTimers();
      vi.setSystemTime(new Date(nowIso));
      try {
        await advanceToFullCadence("repo_1", schedule);
      } finally {
        vi.useRealTimers();
      }
      const arg = update.mock.calls[0]![0] as { data: { nextScanAt: Date } };
      return arg.data.nextScanAt;
    }

    it("monthly keeps the same day-of-month next month (not +30 days)", async () => {
      // +30d from Mar 15 is Apr 14 — the slot slips a day every month. Calendar arithmetic holds it.
      expect((await advancedAt("2026-03-15T09:00:00.000Z", "monthly")).toISOString()).toBe(
        "2026-04-15T09:00:00.000Z",
      );
    });

    it("monthly CLAMPS a day-of-month the target month doesn't have (Jan 31 → Feb 28)", async () => {
      expect((await advancedAt("2026-01-31T00:00:00.000Z", "monthly")).toISOString()).toBe(
        "2026-02-28T00:00:00.000Z",
      );
    });

    it("monthly crosses the year boundary (Dec → Jan of the next year)", async () => {
      expect((await advancedAt("2026-12-10T12:00:00.000Z", "monthly")).toISOString()).toBe(
        "2027-01-10T12:00:00.000Z",
      );
    });

    it("daily / weekly stay exact-duration steps", async () => {
      expect((await advancedAt("2026-03-15T09:00:00.000Z", "daily")).toISOString()).toBe(
        "2026-03-16T09:00:00.000Z",
      );
      expect((await advancedAt("2026-03-15T09:00:00.000Z", "weekly")).toISOString()).toBe(
        "2026-03-22T09:00:00.000Z",
      );
    });

    it('an "off"/unknown schedule writes nothing at all', async () => {
      const update = vi.fn(async () => ({ id: "repo_1" }));
      mockGetPrisma.mockReturnValue({ repository: { update } });
      await advanceToFullCadence("repo_1", "off");
      await advanceToFullCadence("repo_1", "bogus");
      expect(update).not.toHaveBeenCalled();
    });
  });
});

// ── listDueRescans: round-robin fairness across orgs ────────────────────────────────────────

/**
 * Fake prisma whose repository.findMany returns a fixed, oldest-due-first candidate list (the shape
 * the real query produces via `orderBy nextScanAt asc`). `rows` are given in due order; each carries
 * its owning org slug. The fake ignores paging math beyond honoring `take` so we can assert the pure
 * grouping + round-robin interleave the function layers on top.
 */
function fakePrismaWithDue(rows: Array<{ id: string; fullName: string; org: string; schedule?: string }>) {
  let lastArgs: { take?: number; orderBy?: unknown; where?: unknown } | undefined;
  const findMany = vi.fn(async (args: typeof lastArgs) => {
    lastArgs = args;
    const take = args?.take ?? rows.length;
    return rows.slice(0, take).map((r) => ({
      id: r.id,
      fullName: r.fullName,
      scanSchedule: r.schedule ?? "weekly",
      org: { slug: r.org },
    }));
  });
  return { prisma: { repository: { findMany } }, findMany, getArgs: () => lastArgs };
}

describe("listDueRescans round-robin fairness (no org starves another)", () => {
  it("interleaves across orgs instead of letting the oldest-due org monopolize the slice", async () => {
    // orgA dominates the oldest-due head (5 due repos), orgB has 2, orgC has 1 — all interleaved in the
    // candidate list by global due-order. A naive `orderBy nextScanAt take limit` with limit=3 would
    // return [a1,a2,a3] — orgB and orgC starved entirely. Round-robin must spread the limit across orgs.
    const { prisma } = fakePrismaWithDue([
      { id: "a1", fullName: "orgA/r1", org: "orgA" },
      { id: "a2", fullName: "orgA/r2", org: "orgA" },
      { id: "b1", fullName: "orgB/r1", org: "orgB" },
      { id: "a3", fullName: "orgA/r3", org: "orgA" },
      { id: "c1", fullName: "orgC/r1", org: "orgC" },
      { id: "a4", fullName: "orgA/r4", org: "orgA" },
      { id: "b2", fullName: "orgB/r2", org: "orgB" },
      { id: "a5", fullName: "orgA/r5", org: "orgA" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listDueRescans(3);

    expect(out).toHaveLength(3); // respects limit
    const orgs = out.map((r) => r.orgSlug);
    // FAIRNESS: with three orgs holding due work and a budget of 3, each gets exactly one — no single
    // org consumes the whole slice while another with due repos waits.
    expect(new Set(orgs)).toEqual(new Set(["orgA", "orgB", "orgC"]));
    expect(orgs.filter((o) => o === "orgA")).toHaveLength(1);
  });

  it("within an org, the most-overdue (oldest-due) repo is taken first", async () => {
    // Candidate list is global-due-order; the per-org queue preserves that order, so the head of each
    // org's queue is its oldest-due repo. With a limit that exhausts orgA, a1 must precede a2 precede a3.
    const { prisma } = fakePrismaWithDue([
      { id: "a1", fullName: "orgA/r1", org: "orgA" },
      { id: "a2", fullName: "orgA/r2", org: "orgA" },
      { id: "a3", fullName: "orgA/r3", org: "orgA" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listDueRescans(10);

    expect(out.map((r) => r.repoId)).toEqual(["a1", "a2", "a3"]);
  });

  it("drains every due repo round-robin when limit exceeds the candidate count (no loss, no dupes)", async () => {
    const { prisma } = fakePrismaWithDue([
      { id: "a1", fullName: "orgA/r1", org: "orgA" },
      { id: "a2", fullName: "orgA/r2", org: "orgA" },
      { id: "b1", fullName: "orgB/r1", org: "orgB" },
      { id: "c1", fullName: "orgC/r1", org: "orgC" },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listDueRescans(100);
    const ids = out.map((r) => r.repoId);

    expect(ids).toHaveLength(4); // everything due is returned
    expect(new Set(ids).size).toBe(4); // exactly once each — no duplication from the interleave loop
    expect(new Set(ids)).toEqual(new Set(["a1", "a2", "b1", "c1"]));
    // Round-robin order: one per org per round → a1,b1,c1 then a2 (orgA's second).
    expect(ids).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("queries a wider candidate pool than the limit so there is something to interleave", async () => {
    // The fairness only works if the DB read pulls MORE than `limit` rows (it fetches limit*4), else a
    // single dominant org at the head would fill the candidate pool and there'd be nothing to spread.
    const { prisma, getArgs } = fakePrismaWithDue([{ id: "a1", fullName: "orgA/r1", org: "orgA" }]);
    mockGetPrisma.mockReturnValue(prisma);

    await listDueRescans(25);

    const args = getArgs()!;
    expect(args.take).toBeGreaterThan(25);
    expect(args.orderBy).toEqual({ nextScanAt: "asc" }); // candidate pool is still oldest-due first
  });

  it("returns [] (no DB call) when persistence is unconfigured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await listDueRescans()).toEqual([]);
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });
});

// ── recordConformance: the stale-re-run ordering guard (ai-native-standard 07-16 #2) ──────────
// The doctor POSTs headSha so a conformance result can be tied to a commit. Persistence used to be
// last-write-wins with the sha discarded — a retried 2-week-old workflow overwrote the newest score
// invisibly. Now every accepted report appends a `conformance.reported` AuditLog ledger row carrying
// the sha, and an incoming sha that was already reported BEFORE the repo's latest report is skipped.

describe("recordConformance stale-re-run guard (conformance.reported ledger)", () => {
  const REPO = "acme/api";
  const meta = (sha: string | null, score = 50) =>
    JSON.stringify({ repo: REPO, sha, score, fails: 1, warns: 2 });

  /** Fake prisma: `ledger` rows (newest FIRST — mirrors the orderBy desc read), plus spies. */
  function fakeConformancePrisma(ledger: Array<{ meta: string }>) {
    const auditLog = {
      findFirst: vi.fn(async (args: { where: { AND?: Array<{ meta: { contains: string } }> }; orderBy?: unknown }) => {
        if (args.orderBy) return ledger[0] ?? null; // latest-report lookup
        // seen-before lookup: any ledger row containing BOTH fragments.
        const frags = (args.where.AND ?? []).map((c) => c.meta.contains);
        return ledger.find((r) => frags.every((f) => r.meta.includes(f))) ?? null;
      }),
      create: vi.fn(async () => ({ id: "audit_1" })),
    };
    const repository = { updateMany: vi.fn(async () => ({ count: 1 })) };
    return { prisma: { auditLog, repository }, auditLog, repository };
  }

  it("SKIPS a stale re-run: a sha already superseded by a newer report is not persisted (stale:true)", async () => {
    // Ledger newest-first: commit bbb reported after aaa. A CI retry now re-POSTs aaa.
    const { prisma, repository, auditLog } = fakeConformancePrisma([
      { meta: meta("b".repeat(40), 90) },
      { meta: meta("a".repeat(40), 40) },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await recordConformance("acme", REPO, { score: 40, fails: 9, warns: 0, headSha: "a".repeat(40) });

    expect(out).toEqual({ recorded: false, stale: true });
    expect(repository.updateMany).not.toHaveBeenCalled(); // the newest score survives
    expect(auditLog.create).not.toHaveBeenCalled(); // a skipped report never seeds ordering state
  });

  it("records a NEW commit and appends it to the ledger", async () => {
    const { prisma, repository, auditLog } = fakeConformancePrisma([{ meta: meta("b".repeat(40), 90) }]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await recordConformance("acme", REPO, { score: 95, fails: 0, warns: 1, headSha: "c".repeat(40) });

    expect(out).toEqual({ recorded: true, stale: false });
    expect(repository.updateMany).toHaveBeenCalledTimes(1);
    const written = auditLog.create.mock.calls[0][0] as { data: { action: string; meta: string } };
    expect(written.data.action).toBe("conformance.reported");
    expect(JSON.parse(written.data.meta)).toMatchObject({ repo: REPO, sha: "c".repeat(40), score: 95 });
  });

  // This write used to JSON.stringify its meta directly, bypassing withAuditSignature — so conformance
  // rows landed unsigned in the one table whose purpose is tamper-evidence, and for the one action a
  // customer self-reports from their own CI (the rows most worth forging). The signature covers the
  // timestamp, so `at` must be stamped explicitly and match what was signed; letting the DB default it
  // would sign a different instant than the row stores and verify every row as `tampered`.
  it("SIGNS the ledger row, over the timestamp it actually stores (verifies ok on the read path)", async () => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    try {
      const { prisma, auditLog } = fakeConformancePrisma([{ meta: meta("b".repeat(40), 90) }]);
      mockGetPrisma.mockReturnValue(prisma);

      await recordConformance("acme", REPO, { score: 95, fails: 0, warns: 1, headSha: "c".repeat(40) });

      const written = auditLog.create.mock.calls[0][0] as { data: { action: string; at: Date; orgId: string | null; actorId: string | null; meta: string } };
      const stored = JSON.parse(written.data.meta) as Record<string, unknown>;
      expect(typeof stored._sig).toBe("string"); // signed at all — the regression this pins

      // Reconstruct exactly what the read path (getAuditLog) reconstructs from the stored row.
      expect(
        verifyAudit({
          action: written.data.action,
          orgId: written.data.orgId,
          actorId: written.data.actorId,
          createdAt: written.data.at.toISOString(),
          meta: stored,
        }),
      ).toBe("ok");
    } finally {
      delete process.env.AUDIT_SIGNING_SECRET;
    }
  });

  it("allows re-reporting the SAME latest commit (a legitimate same-sha CI re-run updates the score)", async () => {
    const { prisma, repository } = fakeConformancePrisma([{ meta: meta("b".repeat(40), 90) }]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await recordConformance("acme", REPO, { score: 88, fails: 1, warns: 0, headSha: "b".repeat(40) });

    expect(out).toEqual({ recorded: true, stale: false });
    expect(repository.updateMany).toHaveBeenCalledTimes(1);
  });

  it("a sha-less report stays last-write-wins (documented trade-off) and its ledger row carries sha:null", async () => {
    const { prisma, repository, auditLog } = fakeConformancePrisma([{ meta: meta("b".repeat(40), 90) }]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await recordConformance("acme", REPO, { score: 10, fails: 5, warns: 5 });

    expect(out).toEqual({ recorded: true, stale: false });
    expect(repository.updateMany).toHaveBeenCalledTimes(1);
    expect(JSON.parse((auditLog.create.mock.calls[0][0] as { data: { meta: string } }).data.meta).sha).toBeNull();
  });

  it("an untracked repo (updateMany count 0) records nothing and appends NO ledger row", async () => {
    const { prisma, repository, auditLog } = fakeConformancePrisma([]);
    repository.updateMany.mockResolvedValue({ count: 0 });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await recordConformance("acme", REPO, { score: 50, fails: 0, warns: 0, headSha: "d".repeat(40) });

    expect(out).toEqual({ recorded: false, stale: false });
    expect(auditLog.create).not.toHaveBeenCalled();
  });
});

// ── reconcileListedRepos: flag, never evict ─────────────────────────────────────────────────
// Import upserts on (orgId, fullName) and so never duplicates a row, but nothing reconciled
// REMOVALS: a repo renamed/transferred/deleted on GitHub stayed watched forever, kept winning a
// slot in the 100/day rescan cap, failed, took the 6h backoff and repeated invisibly. These pin the
// three properties that make the flag safe to act on — mark on absence, mark NOTHING when the
// evidence is incomplete, and clear the moment the repo comes back.

interface FakeRepoRow {
  id: string;
  fullName: string;
  watched: boolean;
  isPrivate: boolean;
  missingSince: Date | null;
}

function fakeReconcilePrisma(rows: FakeRepoRow[]) {
  const repository = {
    findMany: vi.fn(async () => rows),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  return { prisma: { repository }, repository };
}

/** The ids each updateMany call targeted, keyed by whether it SET or CLEARED the stamp. */
function stampCalls(updateMany: ReturnType<typeof vi.fn>) {
  const marked: string[] = [];
  const cleared: string[] = [];
  for (const call of updateMany.mock.calls) {
    const arg = call[0] as { where: { id: { in: string[] } }; data: { missingSince: Date | null } };
    (arg.data.missingSince === null ? cleared : marked).push(...arg.where.id.in);
  }
  return { marked, cleared };
}

const repoRow = (over: Partial<FakeRepoRow> & { id: string; fullName: string }): FakeRepoRow => ({
  watched: true,
  isPrivate: false,
  missingSince: null,
  ...over,
});

describe("reconcileListedRepos — mark absent, never unwatch", () => {
  it("stamps a watched repo the listing no longer contains", async () => {
    const { prisma, repository } = fakeReconcilePrisma([
      repoRow({ id: "r1", fullName: "acme/alive" }),
      repoRow({ id: "r2", fullName: "acme/gone" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await reconcileListedRepos("acme", ["acme/alive"]);

    expect(out).toEqual({ marked: 1, cleared: 0 });
    const { marked } = stampCalls(repository.updateMany);
    expect(marked).toEqual(["r2"]);
    // NEVER an eviction: a rename is indistinguishable from a deletion here, so watched/scanSchedule
    // must be untouched — the whole point is that the user decides.
    for (const call of repository.updateMany.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data).not.toHaveProperty("watched");
      expect(data).not.toHaveProperty("scanSchedule");
    }
  });

  it("matches names case-insensitively, so a listing's casing can't fake a disappearance", async () => {
    const { prisma } = fakeReconcilePrisma([repoRow({ id: "r1", fullName: "Acme/Web" })]);
    mockGetPrisma.mockReturnValue(prisma);
    expect(await reconcileListedRepos("acme", ["acme/web"])).toEqual({ marked: 0, cleared: 0 });
  });

  it("never re-stamps an already-flagged repo — the displayed date stays the date it went missing", async () => {
    const first = new Date("2026-01-01T00:00:00.000Z");
    const { prisma, repository } = fakeReconcilePrisma([
      repoRow({ id: "r1", fullName: "acme/gone", missingSince: first }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    expect(await reconcileListedRepos("acme", ["acme/other"])).toEqual({ marked: 0, cleared: 0 });
    expect(repository.updateMany).not.toHaveBeenCalled();
  });

  it("marks NOTHING for an empty listing — 'zero repos' is a broken listing far more often than an emptied org", async () => {
    const { prisma, repository } = fakeReconcilePrisma([repoRow({ id: "r1", fullName: "acme/web" })]);
    mockGetPrisma.mockReturnValue(prisma);

    expect(await reconcileListedRepos("acme", [])).toEqual({ marked: 0, cleared: 0 });
    // Not even a read: absence is not evidence, so the whole reconcile is skipped.
    expect(repository.findMany).not.toHaveBeenCalled();
    expect(repository.updateMany).not.toHaveBeenCalled();
  });

  it("marks NOTHING when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await reconcileListedRepos("acme", ["acme/web"])).toEqual({ marked: 0, cleared: 0 });
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("ignores UNWATCHED and PRIVATE repos — the public listing carries no evidence about either", async () => {
    const { prisma, repository } = fakeReconcilePrisma([
      repoRow({ id: "r1", fullName: "acme/unwatched", watched: false }),
      // The org listing is `type=public`, so a private repo is structurally absent from it.
      repoRow({ id: "r2", fullName: "acme/secret", isPrivate: true }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    expect(await reconcileListedRepos("acme", ["acme/web"])).toEqual({ marked: 0, cleared: 0 });
    expect(repository.updateMany).not.toHaveBeenCalled();
  });

  it("CLEARS the stamp when a flagged repo reappears in a later listing", async () => {
    const { prisma, repository } = fakeReconcilePrisma([
      repoRow({ id: "r1", fullName: "acme/back", missingSince: new Date("2026-01-01T00:00:00.000Z") }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const out = await reconcileListedRepos("acme", ["acme/back"]);

    expect(out).toEqual({ marked: 0, cleared: 1 });
    const { cleared } = stampCalls(repository.updateMany);
    expect(cleared).toEqual(["r1"]);
  });

  it("clears a returning repo even when it is no longer watched (a re-watch must not inherit a stale flag)", async () => {
    const { prisma } = fakeReconcilePrisma([
      repoRow({ id: "r1", fullName: "acme/back", watched: false, missingSince: new Date() }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);
    expect(await reconcileListedRepos("acme", ["acme/back"])).toEqual({ marked: 0, cleared: 1 });
  });
});
