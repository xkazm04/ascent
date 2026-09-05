// Unit tests for the org rail's badge counts. The Prisma client is mocked; a fakePrisma captures the
// query shapes so we pin the two things a wrong badge would quietly get wrong:
//   - the backlog count is scoped to each repo's LATEST scan (take:1, scannedAt desc) and to the
//     unresolved statuses — a flat count would tally every historical re-scan's carried-forward rows
//     and print a number that disagrees with what /backlog lists;
//   - a pending invite that has already EXPIRED is not "awaiting a decision", so it never badges.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { getOrgNavCounts } from "@/lib/db/org-nav-counts";

type Where = Record<string, unknown>;

function fakePrisma(opts: {
  org?: { id: string } | null;
  /** Recommendation counts per repo, innermost-first: one array entry per repo's latest scan. */
  recsPerRepo?: number[];
  initiatives?: number;
  invites?: number;
}) {
  const calls = {
    repoFindMany: [] as { where: Where; select: Record<string, unknown> }[],
    initiativeCount: [] as { where: Where }[],
    inviteCount: [] as { where: Where }[],
  };
  return {
    calls,
    client: {
      organization: { findUnique: vi.fn(async () => (opts.org === undefined ? { id: "org_1" } : opts.org)) },
      repository: {
        findMany: vi.fn(async (args: { where: Where; select: Record<string, unknown> }) => {
          calls.repoFindMany.push(args);
          return (opts.recsPerRepo ?? []).map((n) => ({
            scans: [{ recommendations: Array.from({ length: n }, (_, i) => ({ id: `r${i}` })) }],
          }));
        }),
      },
      initiative: {
        count: vi.fn(async (args: { where: Where }) => {
          calls.initiativeCount.push(args);
          return opts.initiatives ?? 0;
        }),
      },
      invite: {
        count: vi.fn(async (args: { where: Where }) => {
          calls.inviteCount.push(args);
          return opts.invites ?? 0;
        }),
      },
    },
  };
}

describe("getOrgNavCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an unknown org", async () => {
    const fake = fakePrisma({ org: null });
    mockGetPrisma.mockReturnValue(fake.client);
    expect(await getOrgNavCounts("nope")).toBeNull();
  });

  it("sums unresolved recommendations across every repo's latest scan", async () => {
    const fake = fakePrisma({ recsPerRepo: [3, 0, 12], initiatives: 4, invites: 2 });
    mockGetPrisma.mockReturnValue(fake.client);

    const counts = await getOrgNavCounts("acme");
    expect(counts).toEqual({ followups: 15, members: 2 });
  });

  it("scopes the backlog count to the latest scan and the unresolved statuses", async () => {
    const fake = fakePrisma({ recsPerRepo: [1] });
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgNavCounts("acme");

    const scans = fake.calls.repoFindMany[0]!.select.scans as {
      take: number;
      orderBy: { scannedAt: string };
      select: { recommendations: { where: { status: { in: string[] } } } };
    };
    expect(scans.take).toBe(1);
    expect(scans.orderBy).toEqual({ scannedAt: "desc" });
    expect(scans.select.recommendations.where.status.in).toEqual(["open", "in_progress"]);
    expect(fake.calls.repoFindMany[0]!.where).toMatchObject({ orgId: "org_1" });
  });

  it("counts only pending invites that have not expired (initiatives retired with the Plan tab)", async () => {
    const fake = fakePrisma({});
    mockGetPrisma.mockReturnValue(fake.client);
    await getOrgNavCounts("acme");

    // The Plan tab and its initiatives are gone (2026-08-17); the badge must not buy their count.
    expect(fake.calls.initiativeCount).toHaveLength(0);

    const inviteWhere = fake.calls.inviteCount[0]!.where as {
      orgId: string;
      status: string;
      expiresAt: { gt: Date };
    };
    expect(inviteWhere.orgId).toBe("org_1");
    expect(inviteWhere.status).toBe("pending");
    expect(inviteWhere.expiresAt.gt).toBeInstanceOf(Date);
  });
});
