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
vi.mock("@/lib/db/org-shared", () => ({
  segmentScope: () => ({}),
}));

import { claimRescan, listDueRescans } from "./org-watch";

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
