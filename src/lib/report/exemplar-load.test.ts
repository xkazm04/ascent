// Tenancy + eligibility guards for the exemplar diff's server reads (moonshot #34).
//
// The fake Prisma below does NOT record calls — it genuinely FILTERS a fixture corpus by the `where`
// it is handed. That is deliberate: a spy-on-the-argument test passes just as happily when the clause
// is present but wrong, whereas removing `orgId` or `isPrivate: false` from a real filter makes the
// other tenant's row come back and the assertion go red. Each fail-before is named on its test.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));

vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (owner: string, name: string) => `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
  resolveOrgId: vi.fn(async (slug: string) => (slug === "nobody" ? null : `org_${slug}`)),
  parseStringArray: (s: string | null) => (s ? (JSON.parse(s) as string[]) : []),
}));

import { isScanEligible, listExemplarOptions, livePublicCorpus, resolveExemplar } from "./exemplar-load";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

interface FakeScan {
  scannedAt: Date;
  overallScore: number;
  archetype: string;
  engineProvider: string;
  rubricVersion: string | null;
  dimensions: { dimId: string; name: string; score: number; signalScore: number; evidence: string; gaps: string }[];
}
interface FakeRepo {
  orgId: string;
  fullName: string;
  isPrivate: boolean;
  primaryLanguage: string | null;
  updatedAt: Date;
  scans: FakeScan[];
}

function fakeScan(o: Partial<FakeScan> & { evidence?: string[] } = {}): FakeScan {
  return {
    scannedAt: new Date("2026-08-01T00:00:00.000Z"),
    overallScore: o.overallScore ?? 70,
    archetype: o.archetype ?? "team",
    engineProvider: o.engineProvider ?? "claude-cli",
    rubricVersion: o.rubricVersion === undefined ? SCORING_RUBRIC_VERSION : o.rubricVersion,
    dimensions: [
      {
        dimId: "D2",
        name: "Testing",
        score: 70,
        signalScore: 70,
        evidence: JSON.stringify(o.evidence ?? ["Coverage tracking configured"]),
        gaps: "[]",
      },
    ],
  };
}

function repo(o: Partial<FakeRepo> & { fullName: string; orgId: string }): FakeRepo {
  return {
    isPrivate: false,
    primaryLanguage: "TypeScript",
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    scans: [fakeScan()],
    ...o,
  };
}

/** `{ not: "mock" }`-aware scalar match, plus plain equality. Only what the module actually uses. */
function matchScalar(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && "not" in (cond as Record<string, unknown>)) {
    return value !== (cond as { not: unknown }).not;
  }
  return value === cond;
}

function scanMatches(s: FakeScan, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => matchScalar((s as unknown as Record<string, unknown>)[k], v));
}

function repoMatches(r: FakeRepo, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "scans") {
      const some = (v as { some?: Record<string, unknown> }).some;
      if (!r.scans.some((s) => scanMatches(s, some))) return false;
      continue;
    }
    if (!matchScalar((r as unknown as Record<string, unknown>)[k], v)) return false;
  }
  return true;
}

let corpus: FakeRepo[] = [];
let dbDown = false;

type FindArgs = {
  where: Record<string, unknown>;
  take?: number;
  select: { scans: { where?: Record<string, unknown>; take?: number } };
};

function makePrisma() {
  // The nested scan filter is read OFF THE ARGUMENTS (`select.scans.where`), never re-stated here —
  // otherwise deleting BENCHMARK_ELIGIBLE from the module would leave this fake still filtering, and
  // the eligibility fail-before would silently stop being a fail-before.
  const find = (args: FindArgs) => {
    if (dbDown) throw new Error("connection refused");
    const rows = corpus.filter((r) => repoMatches(r, args.where)).slice(0, args.take ?? undefined);
    return rows.map((r) => ({
      orgId: r.orgId,
      fullName: r.fullName,
      scans: r.scans
        .filter((s) => scanMatches(s, args.select.scans.where))
        .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())
        .slice(0, args.select.scans.take ?? 1),
    }));
  };
  return {
    repository: {
      findMany: vi.fn(async (args: FindArgs) => find(args)),
      findFirst: vi.fn(async (args: FindArgs) => find(args)[0] ?? null),
    },
    scan: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
        args.where.engineProvider && matchScalar("mock", args.where.engineProvider) ? { id: "s" } : null,
      ),
    },
  };
}

beforeEach(() => {
  dbDown = false;
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue(makePrisma());
  corpus = [
    repo({ orgId: "org_acme", fullName: "acme/web" }),
    repo({ orgId: "org_acme", fullName: "acme/api", scans: [fakeScan({ overallScore: 90, evidence: ["SAST in CI"] })] }),
    repo({ orgId: "org_other", fullName: "other/secret", isPrivate: true }),
    repo({ orgId: "org_other", fullName: "other/public" }),
  ];
});

const ctx = { orgSlug: "acme", subjectFullName: "acme/web" };

describe("resolveExemplar — repo: mode", () => {
  it("resolves a peer repo inside the viewer's org", async () => {
    const out = await resolveExemplar({ kind: "repo", owner: "acme", name: "api" }, ctx);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.profile.repoFullName).toBe("acme/api");
    expect(out.profile.scannedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(out.profile.dimensions[0]!.evidence).toEqual(["SAST in CI"]);
  });

  // FAIL-BEFORE: drop `orgId` from the `repo:` where clause and this returns kind:"ok" carrying
  // another tenant's repo — the cross-tenant read this ref grammar would otherwise invite.
  it("resolves a ref naming ANOTHER tenant's repo as not-found, never forbidden", async () => {
    const out = await resolveExemplar({ kind: "repo", owner: "other", name: "public" }, ctx);
    // not-found, not forbidden: `forbidden` would be an existence oracle confirming the guess.
    expect(out).toEqual({ kind: "not-found" });
  });

  // FAIL-BEFORE: drop the `orgSlug === DEFAULT_ORG_SLUG ? { isPrivate: false }` clause and a private
  // repo becomes resolvable from the shared public namespace.
  it("never resolves a private repo from the shared public org", async () => {
    corpus.push(repo({ orgId: "org_public", fullName: "pub/private-one", isPrivate: true }));
    const out = await resolveExemplar(
      { kind: "repo", owner: "pub", name: "private-one" },
      { orgSlug: "public", subjectFullName: "pub/other" },
    );
    expect(out).toEqual({ kind: "not-found" });
  });

  // FAIL-BEFORE: remove BENCHMARK_ELIGIBLE from SCAN_SELECT / the `some` predicate and this returns
  // kind:"ok" — a deterministic-floor scan ranked as if it were a peer measurement.
  it("never makes a mock-engine scan an exemplar", async () => {
    corpus = [repo({ orgId: "org_acme", fullName: "acme/demo", scans: [fakeScan({ engineProvider: "mock" })] })];
    const out = await resolveExemplar({ kind: "repo", owner: "acme", name: "demo" }, ctx);
    expect(out).toEqual({ kind: "not-found" });
  });

  it("never makes an old-rubric scan an exemplar either", async () => {
    corpus = [repo({ orgId: "org_acme", fullName: "acme/old", scans: [fakeScan({ rubricVersion: "r1" })] })];
    expect(await resolveExemplar({ kind: "repo", owner: "acme", name: "old" }, ctx)).toEqual({ kind: "not-found" });
  });

  it("refuses the subject repo as its own exemplar", async () => {
    expect(await resolveExemplar({ kind: "repo", owner: "acme", name: "web" }, ctx)).toEqual({ kind: "forbidden" });
  });

  it("is not-found when the org itself does not resolve", async () => {
    const out = await resolveExemplar({ kind: "repo", owner: "acme", name: "api" }, { ...ctx, orgSlug: "nobody" });
    expect(out).toEqual({ kind: "not-found" });
  });
});

describe("resolveExemplar — org:best", () => {
  it("picks the org's strongest repo, excluding the subject", async () => {
    const out = await resolveExemplar({ kind: "org-best", dimId: null }, ctx);
    if (out.kind !== "ok") throw new Error(`expected ok, got ${out.kind}`);
    expect(out.profile.repoFullName).toBe("acme/api");
    expect(out.profile.key).toBe("org:best");
  });

  it("is not-found when the org has no other eligible repo", async () => {
    corpus = [repo({ orgId: "org_acme", fullName: "acme/web" })];
    expect(await resolveExemplar({ kind: "org-best", dimId: null }, ctx)).toEqual({ kind: "not-found" });
  });
});

describe("resolveExemplar — cohort:", () => {
  const cohortRef = { kind: "cohort", by: "lang", value: "TypeScript" } as const;

  // FAIL-BEFORE: remove `isPrivate: false` from the cohort query and `other/secret` enters the
  // corpus — the cross-tenant leak of exactly the repos a tenant marked as not-for-sharing.
  it("never lets a private repo enter a cohort", async () => {
    corpus = [
      repo({ orgId: "o1", fullName: "o1/a" }),
      repo({ orgId: "o2", fullName: "o2/b" }),
      repo({ orgId: "o3", fullName: "o3/c" }),
      repo({ orgId: "o4", fullName: "o4/d" }),
      repo({ orgId: "o5", fullName: "o5/secret", isPrivate: true }),
    ];
    // 4 public repos → below the repo floor. With the clause removed there would be 5 and it resolves.
    expect(await resolveExemplar(cohortRef, ctx)).toEqual({ kind: "below-floor", population: 4, min: 5 });
  });

  it("resolves an aggregate-only profile that names no repo", async () => {
    corpus = ["o1", "o2", "o3", "o4", "o5"].map((o, i) => repo({ orgId: o, fullName: `${o}/r`, scans: [fakeScan({ overallScore: 90 - i })] }));
    const out = await resolveExemplar(cohortRef, ctx);
    if (out.kind !== "ok") throw new Error(`expected ok, got ${out.kind}`);
    expect(out.profile.repoFullName).toBeNull();
    expect(out.profile.population).toBe(5);
    // The serialized profile contains no `owner/name`-shaped string at all.
    expect(JSON.stringify(out.profile)).not.toMatch(/o\d\/r/);
  });

  it("reports below-floor with the org floor when five public repos share two tenants", async () => {
    corpus = [
      repo({ orgId: "o1", fullName: "o1/a" }),
      repo({ orgId: "o1", fullName: "o1/b" }),
      repo({ orgId: "o1", fullName: "o1/c" }),
      repo({ orgId: "o2", fullName: "o2/d" }),
      repo({ orgId: "o2", fullName: "o2/e" }),
    ];
    expect(await resolveExemplar(cohortRef, ctx)).toEqual({ kind: "below-floor", population: 2, min: 3 });
  });

  it("reads through the CohortSource seam, so #2's snapshot can replace the live corpus", async () => {
    const source = vi.fn(async () => []);
    const out = await resolveExemplar(cohortRef, ctx, source);
    expect(source).toHaveBeenCalledWith({ by: "lang", value: "TypeScript", cap: 2000 });
    expect(out).toEqual({ kind: "below-floor", population: 0, min: 5 });
  });

  it("filters the archetype slice on the scan's archetype", async () => {
    corpus = ["o1", "o2", "o3", "o4", "o5"].map((o) => repo({ orgId: o, fullName: `${o}/r`, scans: [fakeScan({ archetype: "solo" })] }));
    const members = await livePublicCorpus({ by: "archetype", value: "team", cap: 2000 });
    expect(members).toEqual([]);
    expect(await livePublicCorpus({ by: "archetype", value: "solo", cap: 2000 })).toHaveLength(5);
  });
});

describe("degradation", () => {
  it("returns unavailable rather than throwing when the DB is down", async () => {
    dbDown = true;
    expect(await resolveExemplar({ kind: "repo", owner: "acme", name: "api" }, ctx)).toEqual({ kind: "unavailable" });
  });

  it("returns unavailable when persistence is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await resolveExemplar({ kind: "org-best", dimId: null }, ctx)).toEqual({ kind: "unavailable" });
    expect(await listExemplarOptions({ ...ctx, primaryLanguage: null, archetype: "team" })).toEqual([]);
    expect(await isScanEligible("scan_1")).toBe(false);
  });

  it("hands the picker an empty list rather than a broken page when the DB is down", async () => {
    dbDown = true;
    expect(await listExemplarOptions({ ...ctx, primaryLanguage: "TypeScript", archetype: "team" })).toEqual([]);
  });
});

describe("listExemplarOptions", () => {
  it("offers the org's other repos and org-best, and excludes the subject", async () => {
    const opts = await listExemplarOptions({ ...ctx, primaryLanguage: "TypeScript", archetype: "team" });
    expect(opts.map((o) => o.value)).toEqual(["repo:acme/api", "org:best"]);
    expect(opts[0]!.group).toBe("Your repos");
    expect(opts[1]!.group).toBe("Org best");
  });

  it("offers a cohort option only once it clears BOTH floors — the self-hosted case needs no flag", async () => {
    corpus = [
      repo({ orgId: "org_acme", fullName: "acme/web" }),
      repo({ orgId: "org_acme", fullName: "acme/api" }),
      ...["o1", "o2", "o3"].map((o) => repo({ orgId: o, fullName: `${o}/r` })),
    ];
    const opts = await listExemplarOptions({ ...ctx, primaryLanguage: "TypeScript", archetype: "team" });
    expect(opts.filter((o) => o.group === "Cohort").map((o) => o.value)).toEqual([
      "cohort:lang:TypeScript",
      "cohort:archetype:team",
    ]);

    // One tenant's five public repos: the repo floor clears, the ORG floor does not, so nothing is offered.
    corpus = ["a", "b", "c", "d", "e"].map((n) => repo({ orgId: "org_acme", fullName: `acme/${n}` }));
    const solo = await listExemplarOptions({ ...ctx, primaryLanguage: "TypeScript", archetype: "team" });
    expect(solo.filter((o) => o.group === "Cohort")).toEqual([]);
  });

  it("skips the language slice for a repo with no primary language", async () => {
    corpus = ["o1", "o2", "o3", "o4", "o5"].map((o) => repo({ orgId: o, fullName: `${o}/r` }));
    const opts = await listExemplarOptions({ ...ctx, primaryLanguage: null, archetype: "team" });
    expect(opts.filter((o) => o.group === "Cohort").map((o) => o.value)).toEqual(["cohort:archetype:team"]);
  });

  // UAT `SAM-L1-13`. `readableOrgForOwner` resolves a NON-MEMBER to the shared public namespace, so
  // the exact same query that lists "your other repos" for a member lists up to ORG_CANDIDATE_CAP
  // (500) public-corpus repositories for a visitor — and both were labelled "Your repos", with an
  // "Org best" that meant "best in the public corpus". The label follows the population.
  it("does not call the public corpus 'Your repos' for a viewer resolved to the public org", async () => {
    corpus = [
      repo({ orgId: "org_public", fullName: "pub/web" }),
      repo({ orgId: "org_public", fullName: "pub/other" }),
    ];
    const opts = await listExemplarOptions({
      orgSlug: "public",
      subjectFullName: "pub/web",
      primaryLanguage: null,
      archetype: "team",
    });
    expect(opts.some((o) => o.group === "Your repos")).toBe(false);
    expect(opts.some((o) => o.group === "Org best")).toBe(false);
    expect(opts.filter((o) => o.group === "Public corpus").length).toBeGreaterThan(0);
    const best = opts.find((o) => o.value === "org:best");
    expect(best?.group).toBe("Corpus best");
    expect(best?.label).toBe("best in the public corpus");
  });

  it("still says 'Your repos' for a member of the repo's own org", async () => {
    const opts = await listExemplarOptions({ ...ctx, primaryLanguage: null, archetype: "team" });
    expect(opts.find((o) => o.value === "repo:acme/api")?.group).toBe("Your repos");
    expect(opts.find((o) => o.value === "org:best")?.group).toBe("Org best");
  });
});
