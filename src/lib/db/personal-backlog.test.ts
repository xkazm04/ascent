// Pins the personal-backlog OVERLAY invariants (personal-backlog.ts, individual-tier decision 3):
//
//   • Recommendations are read from the SHARED public org's latest scans; the viewer's status comes
//     ONLY from their overlay rows — the shared Recommendation.status column is never selected, so a
//     fleet's internal tracking can't leak into a personal workspace (and nothing here writes it).
//
//   • setPersonalOverlay refuses a repo that isn't on the viewer's watchlist
//     (OverlayRepoNotWatchedError) — no junk rows for untracked repos.
//
//   • The overlay key is the recommendation's stable identity (repoFullName + dimId + title), the
//     matchRecommendations carry-forward key — so an overlay survives re-scans.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { getPersonalBacklog, setPersonalOverlay, OverlayRepoNotWatchedError } from "./personal-backlog";

const REC = { dimId: "D2", title: "Adopt CI", impact: "high", effort: "low", levelUnlock: "L3" };

function prismaStub(opts: {
  watched?: string[];
  publicRepos?: Array<{ fullName: string; recs: Array<typeof REC> }>;
  overlays?: Array<{ repoFullName: string; dimId: string; title: string; status: string; targetDate?: Date | null; note?: string }>;
  watchedLookup?: boolean;
}) {
  const repoFindMany = vi.fn(async ({ where }: { where: { orgId: string } }) => {
    if (where.orgId === "org_alice") return (opts.watched ?? []).map((fullName) => ({ fullName }));
    return (opts.publicRepos ?? []).map((r) => ({
      fullName: r.fullName,
      owner: r.fullName.split("/")[0],
      name: r.fullName.split("/")[1],
      scans: [
        {
          scannedAt: new Date("2026-07-01T00:00:00Z"),
          recommendations: r.recs,
        },
      ],
    }));
  });
  const upsert = vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
    status: (update.status ?? create.status) as string,
    targetDate: (update.targetDate !== undefined ? update.targetDate : create.targetDate) as Date | null,
    note: (update.note ?? create.note) as string,
  }));
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        if (where.slug === "alice") return { id: "org_alice" };
        if (where.slug === "public") return { id: "org_public" };
        return null;
      }),
    },
    repository: {
      findMany: repoFindMany,
      findFirst: vi.fn(async () => (opts.watchedLookup === false ? null : { id: "repo_1" })),
    },
    recommendationOverlay: {
      findMany: vi.fn(async () => opts.overlays ?? []),
      upsert,
    },
  };
  return { prisma, repoFindMany, upsert };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getPersonalBacklog — overlay merge, shared status never read", () => {
  it("merges the viewer's overlay by (repo, dimId, title); untouched items default to open", async () => {
    const { prisma } = prismaStub({
      watched: ["alice/app"],
      publicRepos: [{ fullName: "alice/app", recs: [REC, { ...REC, dimId: "D5", title: "Add tests" }] }],
      overlays: [{ repoFullName: "alice/app", dimId: "D2", title: "Adopt CI", status: "done", note: "shipped" }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const backlog = (await getPersonalBacklog("alice"))!;

    expect(backlog.total).toBe(2);
    const [ci, tests] = backlog.repos[0]!.items;
    expect(ci!.status).toBe("done");
    expect(ci!.note).toBe("shipped");
    expect(tests!.status).toBe("open"); // sparse: no overlay row = untouched
    expect(backlog.counts).toEqual({ open: 1, in_progress: 0, done: 1, dismissed: 0 });
  });

  it("never selects the shared Recommendation.status column (isolation from org tracking)", async () => {
    const { prisma, repoFindMany } = prismaStub({
      watched: ["alice/app"],
      publicRepos: [{ fullName: "alice/app", recs: [REC] }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    await getPersonalBacklog("alice");

    const publicCall = repoFindMany.mock.calls.find(
      (c) => (c[0] as { where: { orgId: string } }).where.orgId === "org_public",
    )!;
    const recSelect = (
      publicCall[0] as {
        select: { scans: { select: { recommendations: { select: Record<string, boolean> } } } };
      }
    ).select.scans.select.recommendations.select;
    expect(recSelect.status).toBeUndefined();
    expect(recSelect.assigneeLogin).toBeUndefined();
  });

  it("returns an empty backlog for an empty watchlist, null for an unknown org", async () => {
    const { prisma } = prismaStub({ watched: [] });
    mockGetPrisma.mockReturnValue(prisma);
    expect((await getPersonalBacklog("alice"))!.total).toBe(0);
    expect(await getPersonalBacklog("nobody")).toBeNull();
  });
});

describe("setPersonalOverlay — watched-guarded upsert on the stable key", () => {
  it("upserts on (orgId, repoFullName, dimId, title) — the re-scan-stable identity", async () => {
    const { prisma, upsert } = prismaStub({ watched: ["alice/app"] });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setPersonalOverlay(
      "alice",
      { repoFullName: "alice/app", dimId: "D2", title: "Adopt CI" },
      { status: "in_progress" },
    );

    expect(res?.status).toBe("in_progress");
    const arg = upsert.mock.calls[0]![0] as {
      where: { orgId_repoFullName_dimId_title: Record<string, string> };
    };
    expect(arg.where.orgId_repoFullName_dimId_title).toEqual({
      orgId: "org_alice",
      repoFullName: "alice/app",
      dimId: "D2",
      title: "Adopt CI",
    });
  });

  it("throws OverlayRepoNotWatchedError for a repo outside the watchlist", async () => {
    const { prisma } = prismaStub({ watchedLookup: false });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(
      setPersonalOverlay("alice", { repoFullName: "evil/other", dimId: "D2", title: "X" }, { status: "done" }),
    ).rejects.toBeInstanceOf(OverlayRepoNotWatchedError);
  });

  it("ignores an invalid status and an invalid date; null clears the date", async () => {
    const { prisma, upsert } = prismaStub({ watched: ["alice/app"] });
    mockGetPrisma.mockReturnValue(prisma);

    await setPersonalOverlay(
      "alice",
      { repoFullName: "alice/app", dimId: "D2", title: "Adopt CI" },
      { status: "sideways", targetDate: "not-a-date" },
    );
    let arg = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(arg.update).toEqual({}); // both invalid → nothing touched

    await setPersonalOverlay(
      "alice",
      { repoFullName: "alice/app", dimId: "D2", title: "Adopt CI" },
      { targetDate: null },
    );
    arg = upsert.mock.calls[1]![0] as { update: Record<string, unknown> };
    expect(arg.update).toEqual({ targetDate: null }); // explicit clear
  });
});
