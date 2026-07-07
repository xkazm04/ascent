// Pins the best-effort team-standings snapshot persistence: persistTeamStandings writes only when a DB
// is configured, the org resolves, and there are ≥2 teams to contrast (explainTeamStandings non-null),
// and NEVER throws (a failing write resolves false). getTeamStandingsProvenance reads the latest
// denormalized headline row (or null). The client / org-shared / org-teams / pure-derivation boundaries
// are mocked; the raw-SQL calls are asserted via a fake prisma.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgTeamRollup, mockExplain } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgTeamRollup: vi.fn(),
  mockExplain: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-shared", () => ({ normalizeOrgSlug: (s: string) => s.toLowerCase() }));
vi.mock("@/lib/db/org-teams", () => ({ getOrgTeamRollup: mockGetOrgTeamRollup }));
vi.mock("@/lib/org/teamStandings", () => ({ explainTeamStandings: mockExplain }));

import { persistTeamStandings, getTeamStandingsProvenance } from "./team-standings";

const standings = {
  teamCount: 3,
  fleetAvgOverall: 62,
  spread: 24,
  leader: { slug: "platform", avgOverall: 78 },
  laggard: { slug: "mobile", avgOverall: 54 },
};

function fakePrisma(opts: { org?: boolean; execThrows?: boolean; queryRows?: unknown[]; queryThrows?: boolean } = {}) {
  const org = opts.org === false ? null : { id: "org_1" };
  return {
    organization: { findUnique: vi.fn(async () => org) },
    $executeRaw: vi.fn(async () => {
      if (opts.execThrows) throw new Error("write boom");
      return 1;
    }),
    $queryRaw: vi.fn(async () => {
      if (opts.queryThrows) throw new Error("read boom");
      return opts.queryRows ?? [];
    }),
  };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockGetOrgTeamRollup.mockReset();
  mockExplain.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgTeamRollup.mockResolvedValue({ teams: [{}, {}, {}] });
  mockExplain.mockReturnValue(standings);
});

describe("persistTeamStandings", () => {
  it("returns false when the DB is not configured (no write attempted)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await persistTeamStandings("acme")).toBe(false);
  });

  it("returns false for an unknown org (no snapshot written)", async () => {
    const prisma = fakePrisma({ org: false });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await persistTeamStandings("ghost")).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns false (no write) when there aren't ≥2 teams to contrast", async () => {
    const prisma = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockExplain.mockReturnValue(null); // the ≥2-team guard lives in explainTeamStandings
    expect(await persistTeamStandings("acme")).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("writes the snapshot and returns true when there is a valid decomposition", async () => {
    const prisma = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    expect(await persistTeamStandings("acme")).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("is best-effort — a failing write resolves to false instead of throwing", async () => {
    const prisma = fakePrisma({ execThrows: true });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(persistTeamStandings("acme")).resolves.toBe(false);
  });
});

describe("getTeamStandingsProvenance", () => {
  it("returns null when the DB is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getTeamStandingsProvenance("acme")).toBeNull();
  });

  it("returns null for an unknown org", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ org: false }));
    expect(await getTeamStandingsProvenance("ghost")).toBeNull();
  });

  it("returns null when no snapshot has been captured yet", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ queryRows: [] }));
    expect(await getTeamStandingsProvenance("acme")).toBeNull();
  });

  it("maps the latest snapshot row into provenance (spread coerced to a number)", async () => {
    const generatedAt = new Date("2026-07-05T10:00:00Z");
    mockGetPrisma.mockReturnValue(
      fakePrisma({ queryRows: [{ generatedAt, source: "scan", spread: 24, leaderSlug: "platform", laggardSlug: "mobile" }] }),
    );
    const prov = await getTeamStandingsProvenance("acme");
    expect(prov).toEqual({ generatedAt, source: "scan", spread: 24, leaderSlug: "platform", laggardSlug: "mobile" });
  });

  it("is best-effort — a failing read resolves to null instead of throwing", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ queryThrows: true }));
    await expect(getTeamStandingsProvenance("acme")).resolves.toBeNull();
  });
});
