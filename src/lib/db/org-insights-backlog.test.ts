// getOrgBacklog aggregation contract (test-mastery-2026-06-18, backlog-management #2). Pins the six
// headline counts, the ACTIVE-only (open/in_progress) filter that keeps done/dismissed rows OUT of the
// grouped views while still counting them, the byOwner ordering (overdue-desc, then active-desc, with
// Unassigned forced last), the fixed due-bucket order, bot exclusion from the assignee picker, and the
// empty-backlog → all-zeroes (never NaN) path. Uses the vi.hoisted + fakePrisma harness from
// credits.test.ts; scans carry NO dimension rows so projectedPoints/unlocks stay null (the documented
// pre-dimension projection) and the assertions don't couple to the scoring engine.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { getOrgBacklog } from "./org-insights";

// A fixed clock so day-deltas are deterministic regardless of the runner's wall time / timezone.
const NOW = new Date("2026-06-15T12:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

type RecSpec = {
  id: string;
  title?: string;
  dimId?: string;
  impact?: string;
  effort?: string;
  status: string;
  assigneeLogin?: string | null;
  targetDate?: Date | null;
  createdAt?: Date;
};

function rec(r: RecSpec) {
  return {
    id: r.id,
    title: r.title ?? r.id,
    dimId: r.dimId ?? "ci",
    impact: r.impact ?? "medium",
    effort: r.effort ?? "medium",
    status: r.status,
    assigneeLogin: r.assigneeLogin ?? null,
    targetDate: r.targetDate ?? null,
    createdAt: r.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    events: [], // no events → lastActivityAt falls back to createdAt; not asserted here
  };
}

/**
 * Fake prisma for getOrgBacklog: an org row, a set of repos each with one latest scan carrying the
 * supplied recommendation rows (dimensions intentionally empty → projectedGain is skipped), and a
 * distinct repoContributor login set for the assignee picker.
 */
function fakePrisma(opts: {
  repos: Array<{ fullName: string; name: string; recs: ReturnType<typeof rec>[] }>;
  contributors?: string[];
  org?: boolean;
}) {
  const repoRows = opts.repos.map((r) => ({
    fullName: r.fullName,
    name: r.name,
    scans: [{ archetype: "library", dimensions: [], recommendations: r.recs }],
  }));
  const contributorRows = (opts.contributors ?? []).map((login) => ({ login }));
  const prisma = {
    organization: {
      findUnique: vi.fn(async () => (opts.org === false ? null : { id: "org_1", slug: "acme" })),
    },
    repository: {
      findMany: vi.fn(async () => repoRows),
    },
    repoContributor: {
      findMany: vi.fn(async () => contributorRows),
    },
  };
  return prisma;
}

// The standard mixed fleet used by most assertions: 5 active + 1 done + 1 dismissed across two repos.
function mixedFleet() {
  return fakePrisma({
    repos: [
      {
        fullName: "acme/web",
        name: "web",
        recs: [
          // overdue, owned by alice (d = -14)
          rec({ id: "r1", status: "open", assigneeLogin: "alice", targetDate: day("2026-06-01"), impact: "high" }),
          // due this week, owned by alice (d = +3) → counts toward dueSoon
          rec({ id: "r2", status: "in_progress", assigneeLogin: "alice", targetDate: day("2026-06-18") }),
          // done → counted, NOT grouped
          rec({ id: "r3", status: "done", assigneeLogin: "bob", targetDate: day("2026-06-10") }),
          // dismissed → counted, NOT grouped
          rec({ id: "r4", status: "dismissed", assigneeLogin: null, targetDate: null }),
        ],
      },
      {
        fullName: "acme/api",
        name: "api",
        recs: [
          // overdue, UNASSIGNED (d = -3)
          rec({ id: "r5", status: "open", assigneeLogin: null, targetDate: day("2026-06-12") }),
          // open, owned by bob, no due date
          rec({ id: "r6", status: "open", assigneeLogin: "bob", targetDate: null }),
          // in_progress, owned by alice, far out (d = +47) → "later"
          rec({ id: "r7", status: "in_progress", assigneeLogin: "alice", targetDate: day("2026-08-01") }),
        ],
      },
    ],
    contributors: ["alice", "bob", "dependabot[bot]", "unknown"],
  });
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgBacklog — headline counts", () => {
  it("computes the six status/severity counts over ALL rows (done+dismissed included in counts)", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    expect(b).not.toBeNull();
    expect(b.tracked).toBe(7); // every rec across both latest scans, all statuses
    expect(b.active).toBe(5); // open + in_progress only (r1,r2,r5,r6,r7)
    expect(b.open).toBe(3); // r1, r5, r6
    expect(b.inProgress).toBe(2); // r2, r7
    expect(b.done).toBe(1); // r3 — counted though not grouped
    expect(b.dismissed).toBe(1); // r4 — counted though not grouped
    expect(b.overdue).toBe(2); // r1 (d=-14) + r5 (d=-3); only ACTIVE rows ever reach the overdue tally
    expect(b.repos).toBe(2); // both repos contribute recommendations
  });

  it("derives assigned/unassigned/dueSoon from the ACTIVE set only", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // assigned = active rows with an owner: r1,r2 (alice), r6 (bob), r7 (alice) = 4; r5 unassigned.
    expect(b.assigned).toBe(4);
    expect(b.unassigned).toBe(1);
    expect(b.assigned + b.unassigned).toBe(b.active); // reconciles exactly with `active`
    // dueSoon = active, dated, 0 <= dueInDays <= 7: only r2 (+3). r5 is overdue (negative, excluded),
    // r7 is +47, r6 is undated.
    expect(b.dueSoon).toBe(1);
  });
});

describe("getOrgBacklog — ACTIVE-only filter (done/dismissed never grouped)", () => {
  it("keeps done/dismissed rows out of byOwner and byDue, but they remain in the counts", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    const groupedIds = b.byOwner.flatMap((g) => g.items.map((i) => i.id));
    const dueIds = b.byDue.flatMap((g) => g.items.map((i) => i.id));

    // r3 (done) and r4 (dismissed) are counted (done=1, dismissed=1) but appear in NO grouped view.
    expect(groupedIds).not.toContain("r3");
    expect(groupedIds).not.toContain("r4");
    expect(dueIds).not.toContain("r3");
    expect(dueIds).not.toContain("r4");
    expect(groupedIds.sort()).toEqual(["r1", "r2", "r5", "r6", "r7"]);
    // Every grouped item is open or in_progress.
    for (const g of b.byOwner) {
      for (const i of g.items) expect(["open", "in_progress"]).toContain(i.status);
    }
  });

  it("grouped item totals reconcile exactly with the active count", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    const ownerTotal = b.byOwner.reduce((n, g) => n + g.items.length, 0);
    const dueTotal = b.byDue.reduce((n, g) => n + g.items.length, 0);
    expect(ownerTotal).toBe(b.active);
    expect(dueTotal).toBe(b.active);
    // Per-owner `active` field matches its item count.
    for (const g of b.byOwner) expect(g.active).toBe(g.items.length);
  });
});

describe("getOrgBacklog — group ordering", () => {
  it("orders byOwner by overdue-desc, then active-desc, with Unassigned last", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // alice: r1(overdue),r2,r7 → active 3, overdue 1
    // bob:   r6            → active 1, overdue 0
    // null:  r5(overdue)   → active 1, overdue 1 — but Unassigned is forced last regardless.
    expect(b.byOwner.map((g) => g.login)).toEqual(["alice", "bob", null]);

    const alice = b.byOwner[0];
    expect(alice.login).toBe("alice");
    expect(alice.active).toBe(3);
    expect(alice.overdue).toBe(1);
    expect(alice.open).toBe(1); // r1
    expect(alice.inProgress).toBe(2); // r2, r7

    const unassigned = b.byOwner[2];
    expect(unassigned.login).toBeNull();
    expect(unassigned.overdue).toBe(1); // even with an overdue item, it still sorts last
  });

  it("emits due buckets in fixed urgency order, omitting empties", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // Present buckets: overdue (r1,r5), this_week (r2), later (r7), no_date (r6). this_month is empty.
    expect(b.byDue.map((g) => g.bucket)).toEqual(["overdue", "this_week", "later", "no_date"]);
    const overdue = b.byDue.find((g) => g.bucket === "overdue")!;
    expect(overdue.items.map((i) => i.id).sort()).toEqual(["r1", "r5"]);
  });

  it("Unassigned sorts last even when it has the larger/equal overdue+active load", async () => {
    // Owner `solo` has one non-overdue active item; Unassigned has TWO overdue items. If the
    // Unassigned-last rule were dropped, the null group would sort first on overdue-desc.
    mockGetPrisma.mockReturnValue(
      fakePrisma({
        repos: [
          {
            fullName: "acme/x",
            name: "x",
            recs: [
              rec({ id: "a1", status: "open", assigneeLogin: "solo", targetDate: day("2026-07-01") }),
              rec({ id: "a2", status: "open", assigneeLogin: null, targetDate: day("2026-06-01") }),
              rec({ id: "a3", status: "open", assigneeLogin: null, targetDate: day("2026-06-02") }),
            ],
          },
        ],
        contributors: ["solo"],
      }),
    );
    const b = (await getOrgBacklog("acme", null, NOW))!;
    expect(b.byOwner.map((g) => g.login)).toEqual(["solo", null]);
  });
});

describe("getOrgBacklog — assignee picker", () => {
  it("excludes bots/unknown and sorts the human logins", async () => {
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;
    // dependabot[bot] and "unknown" are dropped; the rest sorted.
    expect(b.assignees).toEqual(["alice", "bob"]);
  });
});

describe("getOrgBacklog — empty / boundary", () => {
  it("an empty backlog yields zeroes (never NaN) and empty groups", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ repos: [], contributors: [] }));
    const b = (await getOrgBacklog("acme", null, NOW))!;

    expect(b).not.toBeNull();
    expect(b.tracked).toBe(0);
    expect(b.active).toBe(0);
    expect(b.open).toBe(0);
    expect(b.inProgress).toBe(0);
    expect(b.done).toBe(0);
    expect(b.dismissed).toBe(0);
    expect(b.overdue).toBe(0);
    expect(b.assigned).toBe(0);
    expect(b.unassigned).toBe(0);
    expect(b.dueSoon).toBe(0);
    expect(b.repos).toBe(0);
    expect(b.byOwner).toEqual([]);
    expect(b.byDue).toEqual([]);
    expect(b.assignees).toEqual([]);
    for (const v of [b.tracked, b.active, b.open, b.inProgress, b.done, b.dismissed, b.overdue, b.assigned, b.unassigned, b.dueSoon]) {
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("returns null when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgBacklog("acme", null, NOW)).toBeNull();
  });

  it("returns null when the org does not exist", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ repos: [], org: false }));
    expect(await getOrgBacklog("acme", null, NOW)).toBeNull();
  });
});

// ── projectedPoints (engine-true ROI) + due-boundary counts ───────────────────────────────────────
// The base harness above ships scans with empty `dimensions`, so projectedGain is skipped and every
// item's projectedPoints stays null (the documented pre-dimension path). These tests instead feed REAL
// dimension rows + an archetype so projectedGain runs, and pin: (1) the engine-true points/unlocks each
// rec receives, computed independently from the same overallScoreFor/levelForScore math the engine uses
// (org lens: D1 .15/D2 .15/D3 .14/D4 .12/D5 .09/D6 .07/D7 .07/D8 .12/D9 .09); (2) that a rec whose dimId
// is absent from the scan's dims projects 0 points / null unlocks (truthy 0, never null/NaN); and (3)
// that overdue/dueSoon land exactly on the inclusive [today .. +7d] window with a fixed clock.

// A scan-with-dimensions variant: same shape as fakePrisma, but each repo carries dimension rows + a
// real archetype so the projectedGain path executes. Kept local so the shared fakePrisma (which pins
// the null-projection path) is untouched.
function fakePrismaWithDims(opts: {
  repos: Array<{
    fullName: string;
    name: string;
    archetype: string;
    dims: Array<{ dimId: string; score: number }>;
    recs: ReturnType<typeof rec>[];
  }>;
  contributors?: string[];
}) {
  const repoRows = opts.repos.map((r) => ({
    fullName: r.fullName,
    name: r.name,
    scans: [{ archetype: r.archetype, dimensions: r.dims, recommendations: r.recs }],
  }));
  const contributorRows = (opts.contributors ?? []).map((login) => ({ login }));
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
    repository: { findMany: vi.fn(async () => repoRows) },
    repoContributor: { findMany: vi.fn(async () => contributorRows) },
  };
}

// A single repo whose latest scan carries all 9 dimensions at 60 except D2 at 20 (org lens overall=54,
// L3). Three active recs target D2, D1, and a dimension NOT in the scan, so we can pin each ROI path.
function projectionFleet() {
  const dims = [
    { dimId: "D1", score: 60 },
    { dimId: "D2", score: 20 },
    { dimId: "D3", score: 60 },
    { dimId: "D4", score: 60 },
    { dimId: "D5", score: 60 },
    { dimId: "D6", score: 60 },
    { dimId: "D7", score: 60 },
    { dimId: "D8", score: 60 },
    { dimId: "D9", score: 60 },
  ];
  return fakePrismaWithDims({
    repos: [
      {
        fullName: "acme/web",
        name: "web",
        archetype: "org",
        dims,
        recs: [
          // D2 is the deep gap: closing it (20→100) lifts overall 54→66, crossing L3→L4.
          rec({ id: "p2", status: "open", dimId: "D2", assigneeLogin: "alice", targetDate: day("2026-06-20") }),
          // D1 is already at 60: closing it lifts overall 54→60 (+6) but stays in L3 → unlocks null.
          rec({ id: "p1", status: "in_progress", dimId: "D1", assigneeLogin: "alice", targetDate: null }),
          // dimId not present in the scan's dims → projectedGain raises nothing → 0 points, null unlocks.
          rec({ id: "p0", status: "open", dimId: "D2x", assigneeLogin: "bob", targetDate: null }),
        ],
      },
    ],
    contributors: ["alice", "bob"],
  });
}

describe("getOrgBacklog — projectedPoints (engine-true ROI assembly)", () => {
  const byId = (b: NonNullable<Awaited<ReturnType<typeof getOrgBacklog>>>, id: string) =>
    b.byOwner.flatMap((g) => g.items).find((i) => i.id === id)!;

  it("attaches engine-true points + unlocks to each item from the scan's dims + archetype", async () => {
    mockGetPrisma.mockReturnValue(projectionFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // D2 gap (20→100): overall 54→66 → +12 pts, crosses L3→L4.
    const p2 = byId(b, "p2");
    expect(p2.projectedPoints).toBe(12);
    expect(p2.unlocks).toBe("L4");

    // D1 gap (60→100): overall 54→60 → +6 pts, stays within L3 → no unlock.
    const p1 = byId(b, "p1");
    expect(p1.projectedPoints).toBe(6);
    expect(p1.unlocks).toBeNull();
  });

  it("projects 0 points / null unlocks (never NaN) for a rec whose dimId is absent from the scan", async () => {
    mockGetPrisma.mockReturnValue(projectionFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // p0 targets D2x, which is not among the scan's dimension rows: projectedGain raises nothing, so the
    // overall is unchanged → 0 points. Crucially this is 0 (the truthy-object branch), NOT null, and the
    // `gain ? gain.points : null` ternary doesn't collapse a legitimate 0 to null.
    const p0 = byId(b, "p0");
    expect(p0.projectedPoints).toBe(0);
    expect(p0.unlocks).toBeNull();
    expect(Number.isNaN(p0.projectedPoints as number)).toBe(false);
  });

  it("keeps projectedPoints null (not 0) when the scan predates persisted dimensions", async () => {
    // The shared fakePrisma ships dimensions:[] → projectedGain is skipped entirely. That MUST surface as
    // null (unknown ROI), not 0 (a known zero-point gain) — distinct meanings the UI relies on.
    mockGetPrisma.mockReturnValue(mixedFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;
    for (const it of b.byOwner.flatMap((g) => g.items)) {
      expect(it.projectedPoints).toBeNull();
      expect(it.unlocks).toBeNull();
    }
  });

  it("the ROI fields are display-only and never reorder the list (sort is due/impact/recency)", async () => {
    // p2 has the larger ROI (+12) but a +5d due date; p1 is undated. The sort is soonest-due first, so a
    // dated item precedes the undated one regardless of projectedPoints — pin that ROI doesn't leak in.
    mockGetPrisma.mockReturnValue(projectionFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;
    const alice = b.byOwner.find((g) => g.login === "alice")!;
    expect(alice.items.map((i) => i.id)).toEqual(["p2", "p1"]); // p2 (+5d) before p1 (undated), not by ROI
  });
});

describe("getOrgBacklog — overdue / dueSoon at the date boundaries", () => {
  // A fixed clock (NOW = 2026-06-15) makes day-deltas deterministic. dueSoon is the inclusive window
  // [today .. +7d]; overdue is strictly past (dueInDays < 0). These pin the four edges: -1, 0, +7, +8.
  function boundaryFleet() {
    return fakePrismaWithDims({
      repos: [
        {
          fullName: "acme/b",
          name: "b",
          archetype: "org",
          dims: [], // null projection — irrelevant here; we only assert the date math
          recs: [
            // -1 day → overdue (not dueSoon)
            rec({ id: "d-1", status: "open", assigneeLogin: "alice", targetDate: day("2026-06-14") }),
            // 0 days → due today → dueSoon (lower-inclusive), NOT overdue
            rec({ id: "d0", status: "open", assigneeLogin: "alice", targetDate: day("2026-06-15") }),
            // +7 days → last day of the dueSoon window (upper-inclusive)
            rec({ id: "d7", status: "open", assigneeLogin: "alice", targetDate: day("2026-06-22") }),
            // +8 days → just past the window → neither overdue nor dueSoon
            rec({ id: "d8", status: "open", assigneeLogin: "alice", targetDate: day("2026-06-23") }),
          ],
        },
      ],
      contributors: ["alice"],
    });
  }

  it("counts overdue strictly-past and dueSoon inclusive on both edges (today and +7d)", async () => {
    mockGetPrisma.mockReturnValue(boundaryFleet());
    const b = (await getOrgBacklog("acme", null, NOW))!;

    // Only d-1 is past today.
    expect(b.overdue).toBe(1);
    // d0 (today, dueInDays 0) and d7 (+7) are in-window; d8 (+8) is out; d-1 (overdue) is excluded.
    expect(b.dueSoon).toBe(2);

    const byId2 = (id: string) => b.byOwner.flatMap((g) => g.items).find((i) => i.id === id)!;
    expect(byId2("d-1").dueInDays).toBe(-1);
    expect(byId2("d-1").overdue).toBe(true);
    expect(byId2("d0").dueInDays).toBe(0);
    expect(byId2("d0").overdue).toBe(false);
    expect(byId2("d7").dueInDays).toBe(7);
    expect(byId2("d8").dueInDays).toBe(8);

    // Bucket placement matches the counts: d-1 overdue, d0+d7 this_week, d8 this_month.
    const bucketOf = (id: string) => byId2(id).dueBucket;
    expect(bucketOf("d-1")).toBe("overdue");
    expect(bucketOf("d0")).toBe("this_week");
    expect(bucketOf("d7")).toBe("this_week");
    expect(bucketOf("d8")).toBe("this_month");
  });
});
