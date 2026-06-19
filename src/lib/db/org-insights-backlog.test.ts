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
