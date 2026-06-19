// Bus-factor / concentration / orgAiShare math in getContributorInsights (org-contributors.ts).
// The Contributors page renders "key-person risk" / "bus factor" / "solo maintainer" warnings and the
// headline orgAiShare / aiActiveShare tiles straight off these numbers, so the math is load-bearing and
// must be pinned. The logic is inlined inside the async Prisma function, so we mock getPrisma to return
// crafted repoContributor rows and let the REAL aggregation run.
//
// Pinned invariants:
//   • busFactor = the minimum number of top contributors whose cumulative commits first EXCEED total/2
//     (strict `>`, not `>=`) — pinned on 2-3 crafted distributions including the half-boundary.
//   • topShare = round(top contributor's commits / total * 100).
//   • soloMaintainer = exactly-one contributor OR top contributor owns ≥80% (true at 80, false at 79).
//   • orgAiShare is commit-WEIGHTED across humans (sum aiCommits / sum commits), not a mean of per-person
//     shares — one heavy AI committer can't be diluted to ~0 by many tiny non-AI committers.
//   • aiActiveShare = round(#humans-with-AI / #humans * 100).
//   • [bot]/unknown rows are excluded from every human aggregate.
//   • An empty / zero-commit fleet returns the documented zero-defaults, never a divide-by-zero NaN.
//   • championScore = (aiShare/100)·√repoCount·log2(commits+1), rounded to 2dp; the `champions` list
//     filters to commits≥3 AND aiCommits>0, orders by championScore desc, and slices to the top 6.
//     A 1-commit champion stays FINITE (log2(commits+1), not log2(commits)) — no -Infinity ranking.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { getContributorInsights } from "./org-contributors";

/** One row as repoContributor.findMany returns it for getContributorInsights. */
interface Row {
  login: string;
  name?: string | null;
  commits: number;
  aiCommits?: number;
  lastActiveAt?: Date | null;
  repo: string; // fullName; name is derived as the segment after "/"
}

function row(r: Row) {
  const name = r.repo.includes("/") ? r.repo.split("/").slice(1).join("/") : r.repo;
  return {
    login: r.login,
    name: r.name ?? null,
    commits: r.commits,
    aiCommits: r.aiCommits ?? 0,
    lastActiveAt: r.lastActiveAt ?? null,
    repo: { fullName: r.repo, name },
  };
}

/**
 * Fake prisma matching the two reads getContributorInsights performs: organization.findUnique → the org
 * row, repoContributor.findMany → the crafted contributor rows. `org:false` models a missing org.
 */
function fakePrisma(rows: Row[], opts: { org?: boolean } = {}) {
  const orgRow = opts.org === false ? null : { id: "org_1", slug: "acme" };
  const built = rows.map(row);
  return {
    organization: { findUnique: vi.fn(async () => orgRow) },
    repoContributor: { findMany: vi.fn(async () => built) },
  };
}

/** Find a repo's concentration entry by its short name. */
function conc(res: NonNullable<Awaited<ReturnType<typeof getContributorInsights>>>, name: string) {
  const c = res.concentration.find((r) => r.name === name);
  if (!c) throw new Error(`no concentration entry for repo "${name}"`);
  return c;
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

// ── bus-factor on crafted distributions (the strict `>` half-boundary) ──────────

describe("getContributorInsights bus-factor", () => {
  it("[6,3,2,1] → busFactor 2 (6 does NOT exceed half=6; 6+3 is the first to exceed)", async () => {
    // total=12, half=6. acc=6 → 6 > 6 is FALSE → keep going; acc=9 → 9 > 6 → stop. The strict `>` is
    // the whole point: a `>=` regression would stop at the first contributor and report busFactor 1.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "a", commits: 6, repo: "acme/svc" },
        { login: "b", commits: 3, repo: "acme/svc" },
        { login: "c", commits: 2, repo: "acme/svc" },
        { login: "d", commits: 1, repo: "acme/svc" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    const c = conc(res, "svc");
    expect(c.totalCommits).toBe(12);
    expect(c.busFactor).toBe(2);
    expect(c.topShare).toBe(50); // round(6/12*100)
    expect(c.topLogin).toBe("a");
    expect(c.contributorCount).toBe(4);
    expect(c.soloMaintainer).toBe(false); // 4 authors, top 50% < 80%
  });

  it("[10,1,1,1] → busFactor 1 (the lead alone exceeds half)", async () => {
    // total=13, half=6.5. acc=10 > 6.5 immediately → busFactor 1 (a genuine single-point-of-failure).
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "lead", commits: 10, repo: "acme/api" },
        { login: "x", commits: 1, repo: "acme/api" },
        { login: "y", commits: 1, repo: "acme/api" },
        { login: "z", commits: 1, repo: "acme/api" },
      ]),
    );

    const c = conc((await getContributorInsights("acme"))!, "api");
    expect(c.busFactor).toBe(1);
    expect(c.topShare).toBe(77); // round(10/13*100)=round(76.9)
    expect(c.soloMaintainer).toBe(false); // top 77% < 80% and >1 author
  });

  it("even [5,5,5,5] distribution → high busFactor 3 (need >half before the 4th)", async () => {
    // total=20, half=10. acc=5(1)→no, 10(2)→10>10 FALSE, 15(3)→15>10 TRUE → busFactor 3.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "a", commits: 5, repo: "acme/lib" },
        { login: "b", commits: 5, repo: "acme/lib" },
        { login: "c", commits: 5, repo: "acme/lib" },
        { login: "d", commits: 5, repo: "acme/lib" },
      ]),
    );

    const c = conc((await getContributorInsights("acme"))!, "lib");
    expect(c.busFactor).toBe(3);
    expect(c.topShare).toBe(25);
    expect(c.soloMaintainer).toBe(false);
  });

  it("single-contributor repo → busFactor 1, topShare 100, solo maintainer (high risk)", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([{ login: "solo", commits: 7, repo: "acme/tool" }]),
    );

    const c = conc((await getContributorInsights("acme"))!, "tool");
    expect(c.busFactor).toBe(1);
    expect(c.topShare).toBe(100);
    expect(c.contributorCount).toBe(1);
    expect(c.soloMaintainer).toBe(true);
  });
});

// ── solo-maintainer 80% threshold boundary ──────────────────────────────────────

describe("getContributorInsights soloMaintainer threshold", () => {
  it("80/20 split → soloMaintainer true (top ≥80%); 79/21 → false", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "owner", commits: 80, repo: "acme/at80" },
        { login: "helper", commits: 20, repo: "acme/at80" },
        { login: "owner2", commits: 79, repo: "acme/at79" },
        { login: "helper2", commits: 21, repo: "acme/at79" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;

    const at80 = conc(res, "at80");
    expect(at80.topShare).toBe(80);
    expect(at80.soloMaintainer).toBe(true); // exactly at the ≥80 boundary
    expect(at80.busFactor).toBe(1); // 80 > 50

    const at79 = conc(res, "at79");
    expect(at79.topShare).toBe(79);
    expect(at79.soloMaintainer).toBe(false); // just below the floor → NOT flagged
    expect(at79.busFactor).toBe(1); // 79 > 50

    expect(res.soloMaintainerCount).toBe(1); // only the at80 repo
  });
});

// ── orgAiShare is commit-weighted, not a mean of per-person shares ───────────────

describe("getContributorInsights orgAiShare / aiActiveShare weighting", () => {
  it("orgAiShare is commit-weighted: one heavy 100%-AI committer dominates many tiny non-AI ones", async () => {
    // heavy: 100 commits, all AI. Three light: 1 commit each, no AI.
    // Commit-weighted (correct): aiCommits=100, totalCommits=103 → round(100/103*100)=97.
    // A buggy mean-of-shares would be mean(100,0,0,0)=25 — the assertion below catches that regression.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "heavy", commits: 100, aiCommits: 100, repo: "acme/main" },
        { login: "l1", commits: 1, aiCommits: 0, repo: "acme/main" },
        { login: "l2", commits: 1, aiCommits: 0, repo: "acme/main" },
        { login: "l3", commits: 1, aiCommits: 0, repo: "acme/main" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.orgAiShare).toBe(97); // round(100 / 103 * 100)
    expect(res.orgAiShare).not.toBe(25); // explicitly NOT the mean-of-shares
    expect(res.totalContributors).toBe(4);
    expect(res.aiActive).toBe(1); // only "heavy" has any AI commit
    expect(res.aiActiveShare).toBe(25); // round(1/4*100)
  });

  it("aiActiveShare counts humans with ≥1 AI commit / total humans", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "a", commits: 10, aiCommits: 5, repo: "acme/r" },
        { login: "b", commits: 10, aiCommits: 1, repo: "acme/r" },
        { login: "c", commits: 10, aiCommits: 0, repo: "acme/r" },
        { login: "d", commits: 10, aiCommits: 0, repo: "acme/r" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.aiActive).toBe(2); // a, b
    expect(res.aiActiveShare).toBe(50); // 2/4
    expect(res.orgAiShare).toBe(15); // (5+1)/40 = 15%
  });
});

// ── bot / unknown exclusion ──────────────────────────────────────────────────────

describe("getContributorInsights excludes bots and unknown", () => {
  it("[bot] and unknown rows never appear in any human aggregate", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "human", commits: 4, aiCommits: 2, repo: "acme/svc" },
        { login: "dependabot[bot]", commits: 999, aiCommits: 999, repo: "acme/svc" },
        { login: "unknown", commits: 500, aiCommits: 500, repo: "acme/svc" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(1);
    expect(res.contributors.map((c) => c.login)).toEqual(["human"]);
    const c = conc(res, "svc");
    // The bot/unknown commits must not inflate the repo totals or skew the bus factor.
    expect(c.totalCommits).toBe(4);
    expect(c.contributorCount).toBe(1);
    expect(c.busFactor).toBe(1);
    expect(c.soloMaintainer).toBe(true);
    expect(res.orgAiShare).toBe(50); // 2/4 from the human only, bot/unknown excluded
  });
});

// ── empty / zero-commit fleet: documented defaults, no divide-by-zero NaN ─────────

describe("getContributorInsights empty / zero-commit safety", () => {
  it("an empty fleet returns zero-defaults with no NaN (object, not null)", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([]));

    const res = (await getContributorInsights("acme"))!;
    expect(res).not.toBeNull();
    expect(res.totalContributors).toBe(0);
    expect(res.aiActive).toBe(0);
    expect(res.aiActiveShare).toBe(0);
    expect(res.orgAiShare).toBe(0);
    expect(res.soloMaintainerCount).toBe(0);
    expect(res.concentration).toEqual([]);
    expect(res.champions).toEqual([]);
    expect(Number.isNaN(res.orgAiShare)).toBe(false);
    expect(Number.isNaN(res.aiActiveShare)).toBe(false);
  });

  it("a zero-commit contributor does not trigger a divide-by-zero in shares", async () => {
    // commits:0 is degenerate but must not produce NaN topShare/aiShare/orgAiShare.
    mockGetPrisma.mockReturnValue(
      fakePrisma([{ login: "ghost", commits: 0, aiCommits: 0, repo: "acme/empty" }]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.orgAiShare).toBe(0); // guarded by `totalCommits ? ... : 0`
    const c = conc(res, "empty");
    expect(c.topShare).toBe(0); // guarded by `total ? ... : 0`
    expect(Number.isNaN(c.topShare)).toBe(false);
    expect(res.contributors[0].aiShare).toBe(0); // per-person share also guarded
  });
});

// ── champion ranking: score formula, filter, ordering, finiteness ────────────────

/** Find a champion entry by login (throws if absent — the filter should have kept it). */
function champ(res: NonNullable<Awaited<ReturnType<typeof getContributorInsights>>>, login: string) {
  const c = res.champions.find((x) => x.login === login);
  if (!c) throw new Error(`no champion entry for "${login}"`);
  return c;
}

describe("getContributorInsights champion ranking", () => {
  it("championScore = (aiShare/100)·√repoCount·log2(commits+1), and breadth beats raw volume", async () => {
    // A: 100% AI across 3 repos, 7 commits each → repoCount=3, commits=21.
    //    score = 1 · √3 · log2(22) = 1.7320508 · 4.4594316 = 7.7244… → 7.72
    // B: 100% AI in ONE repo, 21 commits → repoCount=1, commits=21.
    //    score = 1 · 1 · log2(22) = 4.4594… → 4.46
    // Same volume & AI share, but A spreads AI across repos → A must outrank B. A formula change
    // that dropped the √repoCount breadth term (or used a raw mean) would flip this ordering.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "A", commits: 7, aiCommits: 7, repo: "acme/r1" },
        { login: "A", commits: 7, aiCommits: 7, repo: "acme/r2" },
        { login: "A", commits: 7, aiCommits: 7, repo: "acme/r3" },
        { login: "B", commits: 21, aiCommits: 21, repo: "acme/solo" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.champions.map((c) => c.login)).toEqual(["A", "B"]); // A ranked first
    expect(champ(res, "A").championScore).toBeCloseTo(7.72, 2);
    expect(champ(res, "B").championScore).toBeCloseTo(4.46, 2);
    expect(champ(res, "A").championScore).toBeGreaterThan(champ(res, "B").championScore);
  });

  it("excludes contributors with <3 commits or zero AI commits from champions", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "qualifies", commits: 5, aiCommits: 3, repo: "acme/r" }, // ≥3 commits, AI>0 → in
        { login: "tooFewCommits", commits: 2, aiCommits: 2, repo: "acme/r" }, // commits<3 → out
        { login: "noAi", commits: 50, aiCommits: 0, repo: "acme/r" }, // aiCommits===0 → out
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.champions.map((c) => c.login)).toEqual(["qualifies"]);
    // noAi has the most commits but is correctly absent from the AI-champions list.
    expect(res.champions.find((c) => c.login === "noAi")).toBeUndefined();
  });

  it("a 1-commit AI champion has a finite score (log2(commits+1), never -Infinity)", async () => {
    // championScore uses log2(commits + 1): a single-commit dim → log2(2)=1, finite. Dropping the +1
    // would yield log2(0) = -Infinity, dumping a legit 1-commit champion to the bottom of the ranking.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "tiny", commits: 3, aiCommits: 3, repo: "acme/r" }, // min commits to qualify
        { login: "big", commits: 30, aiCommits: 30, repo: "acme/r" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    const tiny = champ(res, "tiny");
    expect(Number.isFinite(tiny.championScore)).toBe(true);
    expect(tiny.championScore).toBeGreaterThan(0);
    // tiny: 1·1·log2(4)=2.00 ; big: 1·1·log2(31)=4.954… → 4.95. big outranks tiny but both finite.
    expect(tiny.championScore).toBeCloseTo(2.0, 2);
    expect(res.champions.map((c) => c.login)).toEqual(["big", "tiny"]);
  });

  it("caps the champions list at the top 6 by championScore", async () => {
    // 8 distinct qualifying champions, descending commits → descending championScore (all 100% AI,
    // single repo). Only the top 6 survive the slice; the two smallest drop off.
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        Array.from({ length: 8 }, (_, i) => ({
          login: `c${i}`,
          commits: 100 - i * 5, // 100, 95, 90, … strictly descending, all ≥3
          aiCommits: 100 - i * 5,
          repo: "acme/r",
        })),
      ),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.champions).toHaveLength(6);
    expect(res.champions.map((c) => c.login)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    // strictly non-increasing championScore across the kept list
    const scores = res.champions.map((c) => c.championScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

// ── small-population success-theater guards (finding #5) ─────────────────────────
// Two load-bearing overstatement guards keep a barely-adopted fleet from being presented
// as "100% AI-native":
//   (1) DATA-LEVEL champion floor: the `champions` filter requires `commits >= 3 && aiCommits > 0`,
//       so a single low-volume Copilot user can never become a celebrated "#1 ★ champion".
//   (2) PAGE-LEVEL population gate (contributors/page.tsx): the AI-champions leaderboard only renders
//       when `champions.length > 0 && totalContributors >= 3`. The data layer can't enforce the JSX
//       gate, but it MUST report `totalContributors` truthfully so the page's `>= 3` floor sees the
//       real population. We pin the boundary (1 / 2 / 3 contributors) and the canonical "team of one
//       reads 100% AI-active" theater number that the gate exists to suppress.
// The pinned floor for the page gate is `MIN_CONTRIBUTORS_FOR_CHAMPIONS = 3`; if the source ever
// exports a shared constant, swap this local for the import — the boundary assertions stay identical.

const MIN_CONTRIBUTORS_FOR_CHAMPIONS = 3;

describe("getContributorInsights small-population champion guard", () => {
  it("a single AI committer (team of one) is NOT a celebrated champion — data-level commits>=3 floor", async () => {
    // The exact success-theater case the page comment warns about: one Copilot user, 1 commit, all AI.
    // `aiActiveShare` is a true 100% for this one person, but `champions` must be EMPTY (commits < 3),
    // so the data layer never hands the page a "#1 ★ champion" for a team of one.
    mockGetPrisma.mockReturnValue(
      fakePrisma([{ login: "solo-copilot", commits: 1, aiCommits: 1, repo: "acme/r" }]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(1);
    expect(res.aiActiveShare).toBe(100); // honest-but-misleading for n=1 — hence the page gate
    expect(res.orgAiShare).toBe(100);
    expect(res.champions).toEqual([]); // commits<3 floor suppresses the lone Copilot user
    expect(res.totalContributors).toBeLessThan(MIN_CONTRIBUTORS_FOR_CHAMPIONS); // page would hide the section
  });

  it("a single HIGH-volume AI committer still falls below the page population floor (n=1 < 3)", async () => {
    // Even with 50 commits the data layer DOES list this person as a champion (commits>=3, aiCommits>0),
    // but totalContributors is 1 — so the page's `>= 3` gate, not the data floor, is what suppresses the
    // "100% AI-active fleet" overstatement. Pin both halves: a populated champion list AND a sub-floor n.
    mockGetPrisma.mockReturnValue(
      fakePrisma([{ login: "power-copilot", commits: 50, aiCommits: 50, repo: "acme/r" }]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(1);
    expect(res.aiActiveShare).toBe(100);
    expect(res.champions.map((c) => c.login)).toEqual(["power-copilot"]); // data layer lists it…
    expect(res.totalContributors).toBeLessThan(MIN_CONTRIBUTORS_FOR_CHAMPIONS); // …but the page hides it (n<3)
  });

  it("a 2-contributor fleet is still below the population floor — page suppresses the leaderboard", async () => {
    // 2 qualifying AI champions, but totalContributors === 2 < 3. The data layer surfaces them; the page
    // gate (totalContributors >= 3) is the line that keeps a 2-person team off the "champions" podium.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "a", commits: 10, aiCommits: 10, repo: "acme/r" },
        { login: "b", commits: 8, aiCommits: 8, repo: "acme/r" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(2);
    expect(res.totalContributors).toBeLessThan(MIN_CONTRIBUTORS_FOR_CHAMPIONS); // below the floor
    expect(res.champions.length).toBeGreaterThan(0); // data has them, page must gate them out
  });

  it("at exactly 3 contributors the population floor is met — champions surface normally", async () => {
    // The boundary: totalContributors === 3 satisfies `>= 3`, so a sufficiently-large population reports
    // normally and the leaderboard is allowed to render. Pin that 3 is the inclusive threshold.
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "a", commits: 12, aiCommits: 12, repo: "acme/r" },
        { login: "b", commits: 9, aiCommits: 6, repo: "acme/r" },
        { login: "c", commits: 6, aiCommits: 3, repo: "acme/r" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(3);
    expect(res.totalContributors).toBeGreaterThanOrEqual(MIN_CONTRIBUTORS_FOR_CHAMPIONS); // floor met
    expect(res.champions.map((c) => c.login)).toEqual(["a", "b", "c"]); // all three qualify, surfaced normally
  });

  it("non-AI contributors pad the population but cannot themselves be champions (floor is AI-gated)", async () => {
    // A 3-person fleet where only ONE person uses AI. The population floor (>=3) is met so the page would
    // render the section, but the champion list contains ONLY the AI user — a non-AI majority can't be
    // dressed up as champions, and the lone AI user isn't inflated into a fleet-wide "everyone uses AI".
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        { login: "ai-user", commits: 10, aiCommits: 10, repo: "acme/r" },
        { login: "no-ai-1", commits: 20, aiCommits: 0, repo: "acme/r" },
        { login: "no-ai-2", commits: 15, aiCommits: 0, repo: "acme/r" },
      ]),
    );

    const res = (await getContributorInsights("acme"))!;
    expect(res.totalContributors).toBe(3); // floor met → page renders the section
    expect(res.champions.map((c) => c.login)).toEqual(["ai-user"]); // only the genuine AI adopter
    expect(res.aiActive).toBe(1);
    expect(res.aiActiveShare).toBe(33); // round(1/3*100) — an HONEST one-third, not a theatrical 100%
  });
});

// ── shared short-circuits ────────────────────────────────────────────────────────

describe("getContributorInsights guards", () => {
  it("returns null when the DB is not configured (no prisma access)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    await expect(getContributorInsights("acme")).resolves.toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("returns null when the org is not found", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([{ login: "a", commits: 1, repo: "acme/r" }], { org: false }),
    );
    await expect(getContributorInsights("acme")).resolves.toBeNull();
  });
});
