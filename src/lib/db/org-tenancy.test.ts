// ORG STATE BY TENANCY, NOT BY OWNER LOGIN.
//
// This is the same defect `repoUnderOrg` was fixed for, on the two surfaces that read a MERGE BAR:
// resolving org-scoped state by the GitHub owner namespace finds nothing for an org named after its
// team, and "nothing" is indistinguishable from "no bar configured" — so the gate went green on the
// archetype default while the owner's dashboard displayed a bar it believed was being enforced.
//
// The second property here matters just as much and is easier to lose: this resolver REFUSES TO
// GUESS. A public repository legitimately appears under several orgs (the shared public series, a
// personal workspace's watch pointers), and on an unauthenticated endpoint, picking one arbitrarily
// would let a stranger's org policy decide another caller's verdict.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockTracks } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
  mockTracks: vi.fn(async () => false),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: mockTracks }));

import { orgSlugForRepo } from "./org-tenancy";

const findMany = vi.fn();

function prismaWith(rows: { org: { slug: string; kind: string } | null }[]) {
  findMany.mockResolvedValue(rows);
  return { repository: { findMany } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockTracks.mockResolvedValue(false);
});

describe("orgSlugForRepo", () => {
  it("takes the OWNER-LOGIN fast path when that org tracks the repo — the common deployment is untouched", async () => {
    mockTracks.mockResolvedValue(true);
    mockGetPrisma.mockReturnValue(prismaWith([]));

    expect(await orgSlugForRepo("acme", "acme/billing")).toBe("acme");
    // Not a single extra query: the fast path is the check `repoUnderOrg` already makes.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("finds the org whose SLUG IS NOT the owner namespace — the case that was silently unenforced", async () => {
    // FAIL-BEFORE: org `kiro` tracking `xkazm04/kp` resolved to the slug "xkazm04", which is not an
    // org, so `getOrgGatePolicy` and the admission overlay both returned null and the gate used the
    // archetype default.
    mockGetPrisma.mockReturnValue(prismaWith([{ org: { slug: "kiro", kind: "org" } }]));

    expect(await orgSlugForRepo("xkazm04", "xkazm04/kp")).toBe("kiro");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fullName: "xkazm04/kp" } }));
  });

  it("IGNORES the shared public series and personal workspaces — lenses, never governance tenants", async () => {
    mockGetPrisma.mockReturnValue(
      prismaWith([
        { org: { slug: "public", kind: "org" } },
        { org: { slug: "alice", kind: "personal" } },
        { org: { slug: "kiro", kind: "org" } },
      ]),
    );

    expect(await orgSlugForRepo("xkazm04", "xkazm04/kp")).toBe("kiro");
  });

  it("refuses to pick between two real tenants — an anonymous caller must not get a stranger's bar", async () => {
    mockGetPrisma.mockReturnValue(
      prismaWith([{ org: { slug: "kiro", kind: "org" } }, { org: { slug: "other-corp", kind: "org" } }]),
    );

    // Ambiguity resolves to the previous behaviour, never to one of the two at random.
    expect(await orgSlugForRepo("xkazm04", "xkazm04/kp")).toBe("xkazm04");
  });

  it("falls back to the owner login when nothing tracks the repo, and without a database", async () => {
    mockGetPrisma.mockReturnValue(prismaWith([]));
    expect(await orgSlugForRepo("acme", "acme/widget")).toBe("acme");

    mockIsDbConfigured.mockReturnValue(false);
    expect(await orgSlugForRepo("acme", "acme/widget")).toBe("acme");
    expect(mockTracks).toHaveBeenCalledTimes(1); // the DB-less call short-circuits before any read
  });
});
