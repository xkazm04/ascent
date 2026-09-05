// Pins the personal-workspace LENS invariants (personal.ts):
//
//   • The scan series is read from the SHARED PUBLIC org's repos (joined by fullName), never from
//     the personal org — the "lens over the public corpus" decision. A regression that reads the
//     personal org's own scans would show an empty dashboard (pointer rows have no scans) or, worse,
//     start motivating duplicate series.
//
//   • Reads are clamped to the personal plan's retention window via retentionCutoff (free = 30d),
//     so the tier's advertised history is real without deleting shared data.
//
//   • Per-repo derivations: delta = latest − previous (null under 2 scans), forecast null until two
//     distinct scan days, an unscanned watched repo still appears (latest null) so the UI can offer
//     its first scan.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { getPersonalWatchlist, countPersonalWatched, isPersonalOrg } from "./personal";

const NOW = Date.parse("2026-07-13T12:00:00Z");
const DAY = 86_400_000;

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

/** A prisma stub for the lens read: personal org + public org lookups, watched pointers, scans. */
function prismaStub(opts: {
  plan?: string;
  watched?: Array<{ owner: string; name: string; fullName: string; url: string }>;
  scans?: Array<{ fullName: string; score: number; daysAgo: number; level?: string; headSha?: string | null }>;
}) {
  const scanFindMany = vi.fn(async () =>
    (opts.scans ?? [])
      .slice()
      .sort((a, b) => b.daysAgo - a.daysAgo)
      .map((s) => ({
        overallScore: s.score,
        level: s.level ?? "L2",
        scannedAt: new Date(NOW - s.daysAgo * DAY),
        headSha: s.headSha ?? null,
        repo: { fullName: s.fullName },
      })),
  );
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        if (where.slug === "alice") return { id: "org_alice", plan: opts.plan ?? "free", kind: "personal" };
        if (where.slug === "public") return { id: "org_public" };
        return null;
      }),
    },
    repository: {
      findMany: vi.fn(async () => opts.watched ?? []),
      count: vi.fn(async () => (opts.watched ?? []).length),
    },
    scan: { findMany: scanFindMany },
  };
  return { prisma, scanFindMany };
}

const REPO = { owner: "alice", name: "app", fullName: "alice/app", url: "https://github.com/alice/app" };

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getPersonalWatchlist — the lens over the public corpus", () => {
  it("reads the series from the PUBLIC org's repos, filtered to the watched fullNames", async () => {
    const { prisma, scanFindMany } = prismaStub({
      watched: [REPO],
      scans: [{ fullName: "alice/app", score: 40, daysAgo: 10 }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const rows = await getPersonalWatchlist("alice", NOW);

    expect(rows).toHaveLength(1);
    const where = scanFindMany.mock.calls[0]![0]!.where as {
      repo: { orgId: string; fullName: { in: string[] } };
    };
    // THE lens invariant: series rows come from the shared public org, joined by fullName.
    expect(where.repo.orgId).toBe("org_public");
    expect(where.repo.fullName.in).toEqual(["alice/app"]);
  });

  it("clamps the window to the free plan's 30-day retention floor", async () => {
    const { prisma, scanFindMany } = prismaStub({ plan: "free", watched: [REPO], scans: [] });
    mockGetPrisma.mockReturnValue(prisma);

    await getPersonalWatchlist("alice", NOW);

    const where = scanFindMany.mock.calls[0]![0]!.where as { scannedAt?: { gte: Date } };
    expect(where.scannedAt?.gte).toBeInstanceOf(Date);
    expect(where.scannedAt!.gte.getTime()).toBe(NOW - 30 * DAY);
  });

  it("derives delta (latest − previous), series order, and a forecast from ≥2 scan days", async () => {
    const { prisma } = prismaStub({
      watched: [REPO],
      scans: [
        { fullName: "alice/app", score: 40, daysAgo: 20 },
        { fullName: "alice/app", score: 46, daysAgo: 10 },
        { fullName: "alice/app", score: 52, daysAgo: 1 },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const [row] = (await getPersonalWatchlist("alice", NOW))!;

    expect(row!.scanCount).toBe(3);
    expect(row!.series.map((p) => p.score)).toEqual([40, 46, 52]); // oldest → newest
    expect(row!.latest?.score).toBe(52);
    expect(row!.delta).toBe(6);
    expect(row!.forecast).not.toBeNull();
    expect(row!.forecast!.trajectory).toBe("rising");
  });

  it("keeps an unscanned watched repo visible (latest/delta/forecast null) so its first scan can be offered", async () => {
    const { prisma } = prismaStub({ watched: [REPO], scans: [] });
    mockGetPrisma.mockReturnValue(prisma);

    const [row] = (await getPersonalWatchlist("alice", NOW))!;

    expect(row!.fullName).toBe("alice/app");
    expect(row!.latest).toBeNull();
    expect(row!.delta).toBeNull();
    expect(row!.forecast).toBeNull();
    expect(row!.scanCount).toBe(0);
  });

  it("single scan → baseline: delta and forecast stay null", async () => {
    const { prisma } = prismaStub({ watched: [REPO], scans: [{ fullName: "alice/app", score: 40, daysAgo: 3 }] });
    mockGetPrisma.mockReturnValue(prisma);

    const [row] = (await getPersonalWatchlist("alice", NOW))!;

    expect(row!.latest?.score).toBe(40);
    expect(row!.delta).toBeNull();
    expect(row!.forecast).toBeNull();
  });

  it("returns null when the personal org doesn't exist, [] for an empty watchlist", async () => {
    const { prisma } = prismaStub({ watched: [] });
    mockGetPrisma.mockReturnValue(prisma);

    expect(await getPersonalWatchlist("nobody", NOW)).toBeNull();
    expect(await getPersonalWatchlist("alice", NOW)).toEqual([]);
  });
});

describe("countPersonalWatched / isPersonalOrg", () => {
  it("counts watched pointers; 0 for an unknown org", async () => {
    const { prisma } = prismaStub({ watched: [REPO] });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await countPersonalWatched("alice")).toBe(1);
    expect(await countPersonalWatched("nobody")).toBe(0);
  });

  it("isPersonalOrg keys strictly on kind === 'personal'", async () => {
    const { prisma } = prismaStub({});
    mockGetPrisma.mockReturnValue(prisma);
    expect(await isPersonalOrg("alice")).toBe(true);
    expect(await isPersonalOrg("nobody")).toBe(false);
  });
});
