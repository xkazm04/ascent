// Pins the ONE read that feeds deploy markers onto the public /trends page.
//
// /trends is reachable for public repos by anyone the sign-in wall lets through, and it authorizes
// the way every repo read does: `readableOrgForOwner(owner)` picks the org the viewer may read (the
// shared "public" org when they cannot read the owner's), and the history reader refuses a PRIVATE
// repo under that shared org. The deployment reader must hold exactly the same line on its own —
// not rely on the page having rendered history first — because a failed production deploy of a
// private repo is exactly the kind of fact that must not leak through a public chart.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockResolveOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
  mockResolveOrgId: vi.fn(async (slug: string) => `org_${slug}`),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "PrismaClientInitializationError") return fallback;
      throw err;
    }
  },
}));

vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (o: string, n: string) => `${o.trim().toLowerCase()}/${n.trim().toLowerCase()}`,
  resolveOrgId: mockResolveOrgId,
}));

import { getRepositoryDeployments, REPO_DEPLOYMENT_CAP } from "@/lib/db/repo-deployments";

function fakePrisma(repo: { id: string; isPrivate: boolean } | null) {
  return {
    repository: { findUnique: vi.fn(async () => repo) },
    deployment: {
      findMany: vi.fn(async () => [
        {
          environment: "production",
          sha: "abc1234def",
          state: "failure",
          createdAt: new Date("2026-09-02T10:00:00.000Z"),
        },
      ]),
    },
  };
}

beforeEach(() => {
  mockIsDbConfigured.mockReturnValue(true);
  mockResolveOrgId.mockClear();
});

describe("getRepositoryDeployments", () => {
  it("refuses a PRIVATE repo under the shared public org and never reads its deployments", async () => {
    const prisma = fakePrisma({ id: "repo_priv", isPrivate: true });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getRepositoryDeployments("acme", "secret", { orgSlug: "public" });

    expect(out).toEqual([]);
    expect(prisma.deployment.findMany).not.toHaveBeenCalled();
  });

  it("treats an omitted orgSlug as the public org, so the private refusal still holds", async () => {
    const prisma = fakePrisma({ id: "repo_priv", isPrivate: true });
    mockGetPrisma.mockReturnValue(prisma);

    expect(await getRepositoryDeployments("acme", "secret")).toEqual([]);
    expect(prisma.deployment.findMany).not.toHaveBeenCalled();
  });

  it("serves a private repo's deployments inside an org the caller resolved as readable", async () => {
    const prisma = fakePrisma({ id: "repo_priv", isPrivate: true });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await getRepositoryDeployments("acme", "secret", { orgSlug: "acme" });

    expect(out).toEqual([
      { environment: "production", sha: "abc1234def", state: "failure", createdAt: "2026-09-02T10:00:00.000Z" },
    ]);
  });

  it("scopes the read to THIS repo row and its org, resolved by the canonical full name", async () => {
    const prisma = fakePrisma({ id: "repo_1", isPrivate: false });
    mockGetPrisma.mockReturnValue(prisma);

    await getRepositoryDeployments("Acme", "Widget", { orgSlug: "public", since: "2026-08-01T00:00:00.000Z" });

    expect(prisma.repository.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_fullName: { orgId: "org_public", fullName: "acme/widget" } } }),
    );
    const args = (prisma.deployment.findMany.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args.where).toEqual({
      repoId: "repo_1",
      orgId: "org_public",
      createdAt: { gte: new Date("2026-08-01T00:00:00.000Z") },
    });
    expect(args.take).toBe(REPO_DEPLOYMENT_CAP);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("guard: an unknown repo or org reads nothing", async () => {
    const prisma = fakePrisma(null);
    mockGetPrisma.mockReturnValue(prisma);
    expect(await getRepositoryDeployments("acme", "ghost", { orgSlug: "acme" })).toEqual([]);
    expect(prisma.deployment.findMany).not.toHaveBeenCalled();

    mockResolveOrgId.mockResolvedValueOnce(null);
    expect(await getRepositoryDeployments("acme", "widget", { orgSlug: "nope" })).toEqual([]);
  });

  it("guard: no database means no deployments, never an error", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getRepositoryDeployments("acme", "widget")).toEqual([]);
  });

  it("drops an unparseable `since` rather than sending Invalid Date to the query", async () => {
    const prisma = fakePrisma({ id: "repo_1", isPrivate: false });
    mockGetPrisma.mockReturnValue(prisma);

    await getRepositoryDeployments("acme", "widget", { since: "not-a-date" });

    const args = (prisma.deployment.findMany.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(args.where).toEqual({ repoId: "repo_1", orgId: "org_public" });
  });
});
