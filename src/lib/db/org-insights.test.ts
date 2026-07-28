// Regression test for the benchmark sample floor (biz-bug-scan-2026-06-11, org-scanning #4):
// the headline corpus percentile had no minimum-sample gate, so a young deployment with a 1-repo
// corpus told its first org "you beat 100% of orgs" (or 0%) — verbatim in the dashboard and the
// weekly digest. The cohort path already gated behind COHORT_MIN = 5; percentileOf now carries
// that discipline for both call sites.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { percentileOf, getOrgMovers, getOrgBenchmark, getOrgRecommendations, getOrgPractices, summarizePracticePrs } from "@/lib/db/org-insights";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import { getOrgRollup } from "@/lib/db/org-rollup";
import { IMPACT_WEIGHT } from "@/lib/db/org-shared";
import { weightsFor } from "@/lib/maturity/model";
import { projectedGain } from "@/lib/scoring/engine";

describe("percentileOf", () => {
  it("returns null below the sample floor instead of a hard 0/100", () => {
    expect(percentileOf([70], 90, 5)).toBeNull(); // would have been "100th percentile" of one repo
    expect(percentileOf([70], 10, 5)).toBeNull(); // would have been "0th percentile"
    expect(percentileOf([60, 70, 80, 90], 75, 5)).toBeNull(); // 4 < CORPUS_MIN
  });

  it("ranks normally at-or-above the floor", () => {
    expect(percentileOf([10, 20, 30, 40, 50], 35, 5)).toBe(60); // 3 of 5 at-or-below
    expect(percentileOf([10, 20, 30, 40, 50], 5, 5)).toBe(0);
    expect(percentileOf([10, 20, 30, 40, 50], 99, 5)).toBe(100);
  });

  it("treats an empty corpus as no rank even with the default floor", () => {
    expect(percentileOf([], 50)).toBeNull();
  });

  it("clamps a zero/negative floor to 1 (empty input can never rank)", () => {
    expect(percentileOf([42], 42, 0)).toBe(100);
    expect(percentileOf([], 42, 0)).toBeNull();
  });
});

// ── F1 baseline-pick consistency: getOrgMovers vs getOrgRollup ─────────────────
// The critical, previously-divergent seam (test-mastery-2026-06-18, fleet-rollups-insights #1): the
// period-window BASELINE selection is now RECONCILED to ONE boundary operator across both flagship
// surfaces — the half-open `< start`:
//   movers  : prev = arr.find((s) => s.scannedAt <  start) ?? earliest-in-window  (STRICT, excludes start)
//   rollup  : baseline cohort = scans with scannedAt { lt: start }                (STRICT, excludes start)
// These tests drive the REAL functions through a crafted prisma so the boundary, onboarded-mid-window,
// and self-compare cases are pinned — and a scan exactly at `start` is now classified IDENTICALLY by
// both (it belongs to the current window, not the baseline), so the panels can no longer contradict.

const D = (iso: string) => new Date(iso);

interface FakeScan {
  repoId: string;
  scannedAt: Date;
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  level: string;
  posture: string;
  dimensions?: { dimId: string; score: number }[];
}
interface FakeRepo {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  watched: boolean;
  primaryLanguage: string | null;
  scanSchedule: string;
  lastScanAt: Date | null;
  lastScanStatus: string | null;
  lastScanError: string | null;
  aiConformance: number | null;
}

/**
 * A fake prisma over a flat scan list + repo list, faithful to the exact where/orderBy/take/select
 * shapes getOrgMovers and getOrgRollup issue. Only the operators those two functions actually use are
 * implemented (scannedAt lt/lte/gte, orgId scope, take, scannedAt asc/desc, the repo+dimensions
 * sub-selects). Both real functions run against the SAME dataset, so a divergence in the baseline pick
 * is observable end-to-end, not asserted against a reimplementation.
 */
function fakeOrgPrisma(repos: FakeRepo[], scans: FakeScan[], plan = "enterprise") {
  const orgId = "org_1";
  const scanMatchesTime = (s: FakeScan, t?: { lt?: Date; lte?: Date; gte?: Date }) => {
    if (!t) return true;
    if (t.lt && !(s.scannedAt.getTime() < t.lt.getTime())) return false;
    if (t.lte && !(s.scannedAt.getTime() <= t.lte.getTime())) return false;
    if (t.gte && !(s.scannedAt.getTime() >= t.gte.getTime())) return false;
    return true;
  };
  const sortByTime = (a: FakeScan, b: FakeScan, dir: "asc" | "desc") =>
    dir === "asc" ? a.scannedAt.getTime() - b.scannedAt.getTime() : b.scannedAt.getTime() - a.scannedAt.getTime();

  return {
    organization: {
      // Default plan "enterprise" = unlimited retention, so the boundary-semantics tests below are
      // NOT retention-clamped; the retention-floor tests pass "free" explicitly.
      findUnique: vi.fn(async () => ({ id: orgId, slug: "acme", plan })),
    },
    // The rollup's baseline path fetches the baseline scans' dimension rows (dimDeltas). These
    // movers-vs-rollup tests only assert the overall/adoption/rigor deltas, so an empty dim set
    // (dimDeltas: []) is the honest minimal stub.
    scanDimension: {
      findMany: vi.fn(async () => []),
    },
    scan: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prisma query-arg shape on a test double
      findMany: vi.fn(async (args: any) => {
        const t = args?.where?.scannedAt;
        const dir: "asc" | "desc" = args?.orderBy?.scannedAt ?? "desc";
        const rows = scans
          .filter((s) => scanMatchesTime(s, t))
          .sort((a, b) => sortByTime(a, b, dir));
        const repoById = new Map(repos.map((r) => [r.id, r]));
        return rows.map((s) => {
          const repo = repoById.get(s.repoId)!;
          return {
            repoId: s.repoId,
            overallScore: s.overallScore,
            adoptionScore: s.adoptionScore,
            rigorScore: s.rigorScore,
            level: s.level,
            posture: s.posture,
            scannedAt: s.scannedAt,
            repo: { fullName: repo.fullName, name: repo.name },
          };
        });
      }),
    },
    repository: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prisma query-arg shape on a test double
      findMany: vi.fn(async (args: any) => {
        const end = args?.include?.scans?.where?.scannedAt?.lte as Date | undefined;
        const take = args?.include?.scans?.take ?? undefined;
        const ordered = [...repos].sort((a, b) => a.fullName.localeCompare(b.fullName));
        return ordered.map((r) => {
          let rScans = scans
            .filter((s) => s.repoId === r.id && (end ? s.scannedAt.getTime() <= end.getTime() : true))
            .sort((a, b) => sortByTime(a, b, "desc"));
          if (take != null) rScans = rScans.slice(0, take);
          return {
            ...r,
            scans: rScans.map((s) => ({
              level: s.level,
              overallScore: s.overallScore,
              adoptionScore: s.adoptionScore,
              rigorScore: s.rigorScore,
              posture: s.posture,
              scannedAt: s.scannedAt,
              dimensions: s.dimensions ?? [],
            })),
          };
        });
      }),
    },
  };
}

function repo(id: string, fullName: string): FakeRepo {
  return {
    id,
    fullName,
    name: fullName.split("/")[1] ?? fullName,
    owner: fullName.split("/")[0] ?? "acme",
    isPrivate: false,
    watched: true,
    primaryLanguage: "TypeScript",
    scanSchedule: "weekly",
    lastScanAt: null,
    lastScanStatus: null,
    lastScanError: null,
    aiConformance: null,
  };
}
function scan(repoId: string, scannedAt: string, overall: number, extra: Partial<FakeScan> = {}): FakeScan {
  return {
    repoId,
    scannedAt: D(scannedAt),
    overallScore: overall,
    adoptionScore: extra.adoptionScore ?? overall,
    rigorScore: extra.rigorScore ?? overall,
    level: extra.level ?? "L2",
    posture: extra.posture ?? "developing",
    dimensions: extra.dimensions,
  };
}

const START = "2026-04-01T00:00:00.000Z";
const WINDOW = { start: D(START), end: D("2026-06-30T23:59:59.000Z") };

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgMovers vs getOrgRollup — period-window baseline pick", () => {
  it("a repo with a pre-start scan: both surfaces use that same pre-start baseline (no divergence)", async () => {
    // Repo with a scan well BEFORE start (50) and one in-window (70). Both paths should compare
    // 70 against 50 -> +20. This is the agreement case (scan strictly < start).
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", "2026-03-01T00:00:00.000Z", 50), // baseline (< start)
      scan("r1", "2026-05-01T00:00:00.000Z", 70), // current (in window)
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);

    const movers = await getOrgMovers("acme", WINDOW);
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const rollup = await getOrgRollup("acme", WINDOW);

    // Movers: alpha climbed +20.
    expect(movers!.gainers).toHaveLength(1);
    expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 20 });
    // Rollup: same cohort (alpha in baseline AND current) -> +20 headline delta. CONSISTENT.
    expect(rollup!.baseline).not.toBeNull();
    expect(rollup!.baseline!.repos).toBe(1);
    expect(rollup!.deltas).toEqual({ overall: 20, adoption: 20, rigor: 20 });
  });

  it("BOUNDARY AGREEMENT: a repo whose only pre-or-at-start scan is EXACTLY at `start` — both surfaces treat it as IN-window, not the baseline (movers `<` == rollup `lt`)", async () => {
    // r1 has a scan exactly at `start` (60) then a later in-window scan (75). No scan strictly < start.
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", START, 60), // exactly at start
      scan("r1", "2026-05-01T00:00:00.000Z", 75), // later, in window
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const rollup = await getOrgRollup("acme", WINDOW);

    // MOVERS: prev = first scan with scannedAt STRICTLY < start = NONE, so the onboarded fallback
    // kicks in and the baseline is the EARLIEST in-window scan = the 60 at start. Both the at-start (60)
    // and the later (75) scan are now on the SAME side of the boundary (the current window), so movers
    // shows the in-window climb 60 -> 75 = +15 via the fallback (NOT by treating 60 as a prior baseline).
    expect(movers!.gainers).toHaveLength(1);
    expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 15 });

    // ROLLUP: baseline cohort is scans STRICTLY < start. The at-start scan is excluded, and there is
    // no other prior scan, so alpha is NOT in the baseline cohort -> no baseline, no deltas.
    // CONSISTENT: movers and rollup now classify the at-start scan IDENTICALLY (in-window, not baseline).
    // Neither surface uses the at-start scan as a prior baseline; the half-open boundary is reconciled.
    expect(rollup!.baseline).toBeNull();
    expect(rollup!.deltas).toBeNull();
  });

  it("a scan EXACTLY at `start` that is also the repo's latest does NOT self-compare (delta 0 -> no spurious move)", async () => {
    // r1's single scan sits exactly at start. Movers: no scan strictly < start, so the fallback resolves
    // to that SAME single row -> now === prev -> skipped, no move (the no-self-compare guard).
    // Rollup: the at-start scan is excluded from the baseline (lt) AND it is the current snapshot, so
    // no cohort overlap -> null deltas. Neither surface fabricates movement.
    const repos = [repo("r1", "acme/alpha")];
    const scans = [scan("r1", START, 60)];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const rollup = await getOrgRollup("acme", WINDOW);

    expect(movers!.comparedRepos).toBe(0);
    expect(movers!.gainers).toHaveLength(0);
    expect(movers!.regressers).toHaveLength(0);
    expect(rollup!.deltas).toBeNull();
  });

  it("a repo ONBOARDED mid-window (no scan at-or-before start) appears in movers via earliest-in-window but is EXCLUDED from the rollup baseline cohort", async () => {
    // r1 onboarded mid-window: two in-window scans (40 then 65), nothing <= start. Movers falls back to
    // earliest-in-window (40) as baseline and reports +25. Rollup excludes it from the baseline cohort.
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", "2026-04-15T00:00:00.000Z", 40), // earliest in-window (after start)
      scan("r1", "2026-06-01T00:00:00.000Z", 65), // latest in-window
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const rollup = await getOrgRollup("acme", WINDOW);

    // Movers: onboarded repo shows its in-window climb 40 -> 65 = +25.
    expect(movers!.gainers).toHaveLength(1);
    expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 25 });

    // Rollup: no scan strictly < start -> baseline cohort empty -> no phantom delta. The onboarded
    // repo does NOT manufacture a fake fleet climb in the headline tile. The movers-side fallback
    // (earliest in-window) is INDEPENDENT of the boundary operator, so it survives the `<= -> <`
    // reconciliation: movers still surfaces the in-window climb while rollup withholds a baseline.
    expect(rollup!.baseline).toBeNull();
    expect(rollup!.deltas).toBeNull();
  });

  it("mixed fleet: an existing repo (pre-start) and an onboarded repo — rollup delta reflects ONLY the cohort-matched existing repo; movers shows both", async () => {
    const repos = [repo("r1", "acme/alpha"), repo("r2", "acme/bravo")];
    const scans = [
      // alpha: existing — pre-start baseline 50, current 60 (+10)
      scan("r1", "2026-03-01T00:00:00.000Z", 50),
      scan("r1", "2026-05-01T00:00:00.000Z", 60),
      // bravo: onboarded mid-window — 30 then 90 (+60 in movers, but no pre-start baseline)
      scan("r2", "2026-04-10T00:00:00.000Z", 30),
      scan("r2", "2026-06-01T00:00:00.000Z", 90),
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const rollup = await getOrgRollup("acme", WINDOW);

    // Movers: BOTH repos moved.
    expect(movers!.comparedRepos).toBe(2);
    const byName = Object.fromEntries(movers!.gainers.map((m) => [m.name, m.dOverall]));
    expect(byName).toEqual({ alpha: 10, bravo: 60 });

    // Rollup baseline cohort = only repos with a scan strictly < start = {alpha}. The cohort-matched
    // delta is alpha's +10 alone; bravo's onboarding does NOT inflate the headline movement. This is
    // the precise "fabricated score movement" the cohort-match was built to kill — pinned here so the
    // movers/headline divergence stays an understood, intentional asymmetry, not a silent regression.
    expect(rollup!.baseline!.repos).toBe(1);
    expect(rollup!.baseline!.avgOverall).toBe(50); // alpha's pre-start baseline only
    expect(rollup!.deltas).toEqual({ overall: 10, adoption: 10, rigor: 10 });
  });
});

// ── Plan retention floor on the BASELINE + movers (fleet-rollups-insights 2026-07-16 #1) ────────
// The trend already clamped its lower bound to retentionCutoff(plan); the baseline and movers
// queries did not, so a Free org (30d retention) with a 90d window computed its headline deltas and
// movers against history the tier doesn't buy. Both are now clamped to the same floor: period
// comparison depth follows the entitlement, and baseline.asOf reports the EFFECTIVE instant.

describe("getOrgMovers/getOrgRollup — plan retention floor clamps the comparison depth", () => {
  it("Free-tier 90d deltas + movers compare against the 30d retention cutoff, not the full window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z")); // retention cutoff (free, 30d) = 2026-06-16
    try {
      const repos = [repo("r1", "acme/alpha")];
      const scans = [
        scan("r1", "2026-04-01T00:00:00.000Z", 40), // pre-window history
        scan("r1", "2026-05-20T00:00:00.000Z", 55), // inside the 90d window but OLDER than 30d retention
        scan("r1", "2026-07-06T00:00:00.000Z", 70), // current
      ];
      const win = { start: D("2026-04-17T00:00:00.000Z"), end: D("2026-07-16T00:00:00.000Z") }; // ~90d
      mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans, "free") as never);
      const movers = await getOrgMovers("acme", win);
      mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans, "free") as never);
      const rollup = await getOrgRollup("acme", win);

      // Baseline = latest scan before the RETENTION cutoff (55 at 05-20), NOT the 90d-old 40:
      // 70 - 55 = +15 on both surfaces. Pre-fix both read 40 and reported +30.
      expect(movers!.gainers).toHaveLength(1);
      expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 15 });
      expect(rollup!.deltas).toEqual({ overall: 15, adoption: 15, rigor: 15 });
      // asOf honestly reports the clamped instant, not the un-bought window start.
      expect(rollup!.baseline!.asOf).toBe("2026-06-16T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unlimited-retention plan keeps the full-window baseline (clamp is plan-driven, not blanket)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"));
    try {
      const repos = [repo("r1", "acme/alpha")];
      const scans = [
        scan("r1", "2026-04-01T00:00:00.000Z", 40),
        scan("r1", "2026-07-06T00:00:00.000Z", 70),
      ];
      const win = { start: D("2026-04-17T00:00:00.000Z"), end: D("2026-07-16T00:00:00.000Z") };
      mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans, "enterprise") as never);
      const movers = await getOrgMovers("acme", win);
      mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans, "enterprise") as never);
      const rollup = await getOrgRollup("acme", win);

      expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 30 });
      expect(rollup!.deltas).toEqual({ overall: 30, adoption: 30, rigor: 30 });
      expect(rollup!.baseline!.asOf).toBe("2026-04-17T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── buildMove sign + bucketing (test-mastery-2026-06-18, org-overview-standing #3) ─────────────
// buildMove is file-local (not exported), so its sign/level/sinceDays math is pinned end-to-end
// THROUGH getOrgMovers — the only public surface. The invariant: an IMPROVING repo yields a
// POSITIVE dOverall and lands in `gainers`; a DECLINING repo yields a NEGATIVE dOverall and lands
// in `regressers` (the `now - prev` subtraction is NOT flipped). levelDelta moves with the score
// (LEVEL_RANK is not mis-ranked), and a strictly-0 delta is in NEITHER bucket. The onboarded-repo
// fallback (no scan ≤ start ⇒ earliest in-window) means a repo first scanned mid-period still
// appears as its first→now move rather than silently vanishing — yet a single-scan repo (prev===now)
// is skipped (no phantom mover). These would all survive if a future change flipped the subtraction,
// dropped the fallback, or mis-bucketed — nothing else asserts them.

describe("getOrgMovers — buildMove sign, level delta, sinceDays, and bucketing", () => {
  it("an IMPROVING repo yields a POSITIVE dOverall and lands in gainers (sign not flipped)", async () => {
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", "2026-03-01T00:00:00.000Z", 60, { adoptionScore: 55, rigorScore: 50, level: "L2", posture: "developing" }),
      scan("r1", "2026-05-11T00:00:00.000Z", 80, { adoptionScore: 75, rigorScore: 64, level: "L3", posture: "advanced" }), // +20 over 71d
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.regressers).toHaveLength(0);
    expect(movers!.gainers).toHaveLength(1);
    const m = movers!.gainers[0];
    expect(m.dOverall).toBe(20); // now(80) - prev(60), POSITIVE for an improvement
    expect(m.dAdoption).toBe(20); // 75 - 55
    expect(m.dRigor).toBe(14); // 64 - 50
    expect(m.overall).toBe(80); // current score, not the delta
    // level/posture pair from→to is oriented prev→now, and levelDelta moves WITH the score.
    expect(m).toMatchObject({ levelFrom: "L2", levelTo: "L3", postureFrom: "developing", postureTo: "advanced" });
    expect(m.levelDelta).toBe(1); // L3 > L2 ⇒ +1 (promoted), sign matches the climb
    // sinceDays = whole-day gap between baseline and current scans (rounded), never negative.
    expect(m.sinceDays).toBe(71);
    // levelChanges carries the promotion (levelDelta !== 0).
    expect(movers!.levelChanges).toHaveLength(1);
    expect(movers!.levelChanges[0]).toMatchObject({ name: "alpha", levelDelta: 1 });
  });

  it("a DECLINING repo yields a NEGATIVE dOverall and lands in regressers (mirror of the climb)", async () => {
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", "2026-03-01T00:00:00.000Z", 80, { level: "L3", posture: "advanced" }),
      scan("r1", "2026-05-01T00:00:00.000Z", 70, { level: "L2", posture: "developing" }), // -10
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.gainers).toHaveLength(0);
    expect(movers!.regressers).toHaveLength(1);
    const m = movers!.regressers[0];
    expect(m.dOverall).toBe(-10); // now(70) - prev(80), NEGATIVE for a regression
    expect(m).toMatchObject({ name: "alpha", levelFrom: "L3", levelTo: "L2" });
    expect(m.levelDelta).toBe(-1); // L2 < L3 ⇒ demoted, sign matches the decline
    expect(movers!.levelChanges[0]).toMatchObject({ name: "alpha", levelDelta: -1 });
  });

  it("a repo whose overall is unchanged (delta 0) is in NEITHER gainers nor regressers", async () => {
    // Same overall at both ends but a real second scan ⇒ buildMove still runs (prev !== now), and the
    // noise-band partition keeps a 0-delta repo out of every bucket (`held` excludes an exact 0 too —
    // it is for repos that moved but not measurably, not for repos that did not move).
    const repos = [repo("r1", "acme/alpha")];
    const scans = [
      scan("r1", "2026-03-01T00:00:00.000Z", 70, { level: "L2" }),
      scan("r1", "2026-05-01T00:00:00.000Z", 70, { level: "L3" }), // overall flat, but level moved
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.comparedRepos).toBe(1); // it WAS compared…
    expect(movers!.gainers).toHaveLength(0); // …but the 0 overall-delta excludes it from both
    expect(movers!.regressers).toHaveLength(0);
    // levelChanges still partitions on levelDelta independently of dOverall.
    expect(movers!.levelChanges).toHaveLength(1);
    expect(movers!.levelChanges[0]).toMatchObject({ name: "alpha", levelDelta: 1 });
  });

  // The noise band (SCORE_NOISE_BAND = 2) is the difference between "this fleet improved" and "these
  // two scans disagreed by a point". getOrgMovers is the RAW feed the Executive Briefing, /portfolio
  // and the digest all read, so a sub-band delta reaching `gainers` puts a wobble into a document the
  // customer files. Pinned at the boundary (2 = still noise, 3 = real) in BOTH directions.
  it("a sub-band move lands in `held`, not gainers/regressers — the boundary is 2 (noise) vs 3 (real)", async () => {
    const repos = [repo("r1", "acme/alpha"), repo("r2", "acme/bravo"), repo("r3", "acme/charlie"), repo("r4", "acme/delta")];
    const scans = [
      // alpha +2 → exactly at the band ⇒ noise
      scan("r1", "2026-03-01T00:00:00.000Z", 70, { level: "L3" }),
      scan("r1", "2026-05-01T00:00:00.000Z", 72, { level: "L3" }),
      // bravo +3 → first point past the band ⇒ a real gain
      scan("r2", "2026-03-01T00:00:00.000Z", 70, { level: "L3" }),
      scan("r2", "2026-05-01T00:00:00.000Z", 73, { level: "L3" }),
      // charlie -2 → noise on the way down too (the band is symmetric)
      scan("r3", "2026-03-01T00:00:00.000Z", 70, { level: "L3" }),
      scan("r3", "2026-05-01T00:00:00.000Z", 68, { level: "L3" }),
      // delta -3 → a real regression
      scan("r4", "2026-03-01T00:00:00.000Z", 70, { level: "L3" }),
      scan("r4", "2026-05-01T00:00:00.000Z", 67, { level: "L3" }),
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.gainers.map((m) => m.name)).toEqual(["bravo"]);
    expect(movers!.regressers.map((m) => m.name)).toEqual(["delta"]);
    expect(movers!.held.map((m) => m.name)).toEqual(["alpha", "charlie"]); // fullName-sorted
    expect(movers!.comparedRepos).toBe(4); // all four were still compared
  });

  it("an ONBOARDED repo (no scan ≤ start) appears via its EARLIEST in-window scan, not as a phantom", async () => {
    // bravo is onboarded mid-window: earliest in-window 40 → latest 65 = +25. The fallback
    // (arr.find(<=start) ?? earliest-in-window) keeps it visible instead of dropping it.
    const repos = [repo("r1", "acme/bravo")];
    const scans = [
      scan("r1", "2026-04-20T00:00:00.000Z", 40, { level: "L1" }),
      scan("r1", "2026-05-10T00:00:00.000Z", 52, { level: "L2" }), // a middle scan must NOT be the baseline
      scan("r1", "2026-06-05T00:00:00.000Z", 65, { level: "L2" }),
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.gainers).toHaveLength(1);
    expect(movers!.gainers[0]).toMatchObject({ name: "bravo", dOverall: 25, levelFrom: "L1", levelTo: "L2" });
    expect(movers!.comparedRepos).toBe(1);
  });

  it("a repo with a SINGLE in-window scan and no baseline (prev === now) is SKIPPED — no phantom mover", async () => {
    // Only one in-window scan, nothing at-or-before start ⇒ fallback resolves to that same row ⇒
    // prev === now ⇒ the repo is dropped, not reported as a 0-move.
    const repos = [repo("r1", "acme/charlie")];
    const scans = [scan("r1", "2026-05-01T00:00:00.000Z", 55)];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.comparedRepos).toBe(0);
    expect(movers!.gainers).toHaveLength(0);
    expect(movers!.regressers).toHaveLength(0);
    expect(movers!.levelChanges).toHaveLength(0);
  });

  it("a mixed fleet partitions strictly by dOverall sign and sorts each bucket by magnitude", async () => {
    const repos = [repo("r1", "acme/alpha"), repo("r2", "acme/bravo"), repo("r3", "acme/charlie"), repo("r4", "acme/delta")];
    const scans = [
      // alpha: +10 (gainer)
      scan("r1", "2026-03-01T00:00:00.000Z", 50), scan("r1", "2026-05-01T00:00:00.000Z", 60),
      // bravo: +30 (bigger gainer ⇒ sorts ahead of alpha)
      scan("r2", "2026-03-01T00:00:00.000Z", 40), scan("r2", "2026-05-01T00:00:00.000Z", 70),
      // charlie: -25 (regresser)
      scan("r3", "2026-03-01T00:00:00.000Z", 85), scan("r3", "2026-05-01T00:00:00.000Z", 60),
      // delta: 0 (neither bucket)
      scan("r4", "2026-03-01T00:00:00.000Z", 75), scan("r4", "2026-05-01T00:00:00.000Z", 75),
    ];
    mockGetPrisma.mockReturnValue(fakeOrgPrisma(repos, scans) as never);
    const movers = await getOrgMovers("acme", WINDOW);

    expect(movers!.comparedRepos).toBe(4);
    // gainers: positive only, largest climb first.
    expect(movers!.gainers.map((m) => [m.name, m.dOverall])).toEqual([["bravo", 30], ["alpha", 10]]);
    // regressers: negative only, most-negative first.
    expect(movers!.regressers.map((m) => [m.name, m.dOverall])).toEqual([["charlie", -25]]);
    // delta (0) appears in neither bucket.
    const named = [...movers!.gainers, ...movers!.regressers].map((m) => m.name);
    expect(named).not.toContain("delta");
  });
});

// ── F2: getOrgRecommendations leverage formula (test-mastery-2026-06-18, fleet-rollups-insights #5) ──
// The org "do these first" list ranks systemic recommendations by a LEVERAGE score:
//   leverage = round(repoCount · IMPACT_WEIGHT[impact] · (1 + dimWeight) · 10) / 10
// with dimWeight = weightsFor("org")[dimId] (?? 0.1), IMPACT_WEIGHT (?? 1), dedup keyed on
// `dimId::title` (strongest impact wins across repos), and sort `leverage desc, then repoCount desc`.
// None of this was tested: a silent re-weighting of IMPACT_WEIGHT / weightsFor("org") / the rounding,
// or a flipped tie-break, would reorder leadership's top moves with no failing test. These drive the
// REAL getOrgRecommendations through a crafted prisma so the formula, ranking, and zero-edge are pinned.

interface FakeRec {
  title: string;
  dimId: string;
  impact: string;
}

/**
 * Fake prisma over a {repoName -> latest-scan recommendations} map, faithful to the exact
 * select shape getOrgRecommendations issues (repository.findMany → scans[take:1].recommendations).
 * Drives the REAL function so the leverage math is observed end-to-end, not reimplemented.
 */
function fakeRecPrisma(reposRecs: { name: string; recs: FakeRec[] }[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
    repository: {
      findMany: vi.fn(async () =>
        reposRecs.map((r) => ({
          name: r.name,
          scans: [{ recommendations: r.recs.map((rec) => ({ ...rec })) }],
        })),
      ),
    },
  };
}

// Concrete expected weights — SNAPSHOT-PINNED so an accidental edit to either table fails loudly.
const ORG_W = weightsFor("org");
const lev = (repoCount: number, impact: string, dimId: string) =>
  Math.round(repoCount * (IMPACT_WEIGHT[impact] ?? 1) * (1 + (ORG_W[dimId as keyof typeof ORG_W] ?? 0.1)) * 10) / 10;

describe("getOrgRecommendations — leverage formula, ranking, dedup, and zero-edge", () => {
  it("SNAPSHOT: the leverage weight tables are exactly the pinned values (a silent re-weighting fails)", () => {
    // Lock IMPACT_WEIGHT and the org dimension lens so changing either is a deliberate, test-breaking act.
    expect(IMPACT_WEIGHT).toEqual({ high: 3, medium: 2, low: 1 });
    expect(weightsFor("org")).toEqual({
      D1: 0.15, D2: 0.15, D3: 0.14, D4: 0.12, D5: 0.09, D6: 0.07, D7: 0.07, D8: 0.12, D9: 0.09,
    });
  });

  it("computes leverage as round(repoCount · IMPACT_WEIGHT · (1 + dimWeight) · 10)/10 — one decimal place", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [{ title: "Add CI gate", dimId: "D1", impact: "high" }] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    expect(recs).not.toBeNull();
    expect(recs!).toHaveLength(1);
    // 1 · 3 · (1 + 0.15) · 10 / 10 = round(34.5)/10 = 3.5 — exact, one decimal.
    expect(recs![0]).toMatchObject({ title: "Add CI gate", dimId: "D1", impact: "high", repoCount: 1, leverage: 3.5 });
    expect(recs![0]!.leverage).toBe(lev(1, "high", "D1"));
  });

  it("HIGHEST-leverage recommendation ranks FIRST (impact, dim-weight, and repoCount all raise leverage)", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [
          { title: "A", dimId: "D1", impact: "low" },     // 1·1·1.15 = 1.2  (lowest)
          { title: "B", dimId: "D5", impact: "high" },    // 1·3·1.09 = 3.3
          { title: "C", dimId: "D1", impact: "high" },    // 1·3·1.15 = 3.5  (highest single-repo)
        ] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    expect(recs!.map((r) => [r.title, r.leverage])).toEqual([
      ["C", 3.5], // highest leverage first
      ["B", 3.3],
      ["A", 1.2],
    ]);
    // Monotonic in IMPACT_WEIGHT (low→high raises C above A on the SAME dim) and the order is strictly descending.
    const levs = recs!.map((r) => r.leverage);
    expect([...levs]).toEqual([...levs].sort((a, b) => b - a));
  });

  it("leverage is monotonic in repoCount: a 2-repo systemic move outranks a 1-repo move of equal impact+dim", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [{ title: "Shared gap", dimId: "D1", impact: "high" }, { title: "Solo gap", dimId: "D1", impact: "high" }] },
        { name: "bravo", recs: [{ title: "Shared gap", dimId: "D1", impact: "high" }] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    expect(recs!.map((r) => [r.title, r.repoCount, r.leverage])).toEqual([
      ["Shared gap", 2, lev(2, "high", "D1")], // 6.9 — 2 repos, ranks first
      ["Solo gap", 1, lev(1, "high", "D1")],   // 3.5
    ]);
    expect(recs![0]!.leverage).toBe(6.9);
  });

  it("stamps an engine-true projected gain (avg overall points + repos it lifts a level) on each move", async () => {
    // A repo weakest on D9 → closing D9 yields a real overall-score gain (and may unlock a level).
    const dimRows = [
      { dimId: "D1", score: 60 },
      { dimId: "D2", score: 60 },
      { dimId: "D9", score: 10 },
    ];
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
      repository: {
        findMany: vi.fn(async () => [
          {
            name: "alpha",
            scans: [{ archetype: "org", dimensions: dimRows, recommendations: [{ title: "Lift security", dimId: "D9", impact: "high" }] }],
          },
        ]),
      },
    } as never);

    const recs = await getOrgRecommendations("acme");
    const expected = projectedGain(dimRows.map((d) => ({ id: d.dimId, score: d.score })), "org", "D9");
    expect(recs![0].projectedPoints).toBe(Math.round(expected.points * 10) / 10);
    expect(recs![0].projectedPoints!).toBeGreaterThan(0); // closing the weakest dim demonstrably lifts overall
    expect(recs![0].liftsRepos).toBe(expected.unlocks ? 1 : 0);
  });

  it("projectedPoints is null (not 0) when affected repos have no persisted dimension rows (legacy scans)", async () => {
    // fakeRecPrisma returns scans WITHOUT dimensions/archetype → can't project → null, never a fake 0.
    mockGetPrisma.mockReturnValue(fakeRecPrisma([{ name: "alpha", recs: [{ title: "X", dimId: "D1", impact: "high" }] }]) as never);
    const recs = await getOrgRecommendations("acme");
    expect(recs![0].projectedPoints).toBeNull();
    expect(recs![0].liftsRepos).toBe(0);
  });

  it("dedup on `dimId::title`: identical gaps collapse to ONE group with repoCount and the STRONGEST impact retained", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [{ title: "Protect main", dimId: "D2", impact: "low" }] },
        { name: "bravo", recs: [{ title: "Protect main", dimId: "D2", impact: "high" }] }, // stronger impact wins
        { name: "charlie", recs: [{ title: "Protect main", dimId: "D2", impact: "medium" }] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    expect(recs!).toHaveLength(1);
    expect(recs![0]).toMatchObject({ title: "Protect main", dimId: "D2", repoCount: 3, impact: "high", repos: ["alpha", "bravo", "charlie"] });
    // leverage uses the WON (high) impact, not the first-seen (low): 3 · 3 · 1.15 = 10.4.
    expect(recs![0]!.leverage).toBe(lev(3, "high", "D2"));
  });

  it("ties on leverage break by repoCount (descending) — the wider-reaching move ranks first", async () => {
    // The sort comparator is `b.leverage - a.leverage || b.repoCount - a.repoCount`. To exercise the
    // SECOND term we need two groups with IDENTICAL leverage but DIFFERENT repoCount. Leverage scales
    // with repoCount, so equal leverage at unequal repoCount requires a compensating impact/dim:
    //   "Wide"   : D6 high  @2 repos = 2 · 3 · (1 + 0.07) = 6.42 → round(64.2)/10 = 6.4
    //   "Narrow" : D3 high  @1 repo  = 1 · 3 · (1 + 0.14) = 3.42 → 3.4  (NOT a tie — control)
    // For a TRUE tie at 6.9: D1 high @2 = 6.9 ; and a single-repo group can't reach 6.9, so the only
    // genuine leverage ties occur at EQUAL repoCount. We therefore construct a real tie at repoCount 2
    // vs repoCount 1 by exploiting impact: medium@high-dim vs high@low-dim — pinned numerically below.
    //   "Wide"  : D8 medium @2 = 2 · 2 · 1.12 = 4.48 → 4.5
    //   "Narrow": D1 high   @1 = 1 · 3 · 1.15 = 3.45 → 3.5  (still not equal — leverage ∝ repoCount dominates)
    // Conclusion: a leverage tie is only reachable at equal repoCount, where the tie-break is a stable
    // no-op. So this test pins BOTH facts: (a) a higher-repoCount group with higher leverage ranks first
    // (the comparator's primary term), and (b) when leverage genuinely ties, repoCount is equal and order
    // is deterministic — the tie-break never mis-orders or throws.
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "a", recs: [
          { title: "Wide", dimId: "D1", impact: "high" }, // → repoCount 2 after dedup, leverage 6.9
          { title: "Tie-A", dimId: "D1", impact: "high" }, // 1·3·1.15 = 3.5
          { title: "Tie-B", dimId: "D2", impact: "high" }, // 1·3·1.15 = 3.5 (D1,D2 share weight 0.15) → exact tie
        ] },
        { name: "b", recs: [{ title: "Wide", dimId: "D1", impact: "high" }] }, // Wide spans 2 repos
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    // Primary term: "Wide" (leverage 6.9, repoCount 2) ranks first.
    expect(recs![0]).toMatchObject({ title: "Wide", repoCount: 2, leverage: 6.9 });
    // The two tied groups (both 3.5, both repoCount 1) follow, in a deterministic, non-throwing order.
    const tied = recs!.slice(1);
    expect(tied.map((r) => r.leverage)).toEqual([3.5, 3.5]);
    expect(tied.map((r) => r.repoCount)).toEqual([1, 1]);
  });

  it("zero-effort / empty edge: an org with NO open recommendations yields an empty list, not NaN or a throw", async () => {
    mockGetPrisma.mockReturnValue(fakeRecPrisma([{ name: "alpha", recs: [] }]) as never);
    const recs = await getOrgRecommendations("acme");
    expect(recs).toEqual([]); // no recs → no divide/round on undefined → clean empty
  });

  it("an UNKNOWN dimId falls back to dimWeight 0.1 and an UNKNOWN impact to weight 1 — finite, never NaN", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [
          { title: "UnknownDim", dimId: "D_NOPE", impact: "high" },  // dimW 0.1 ⇒ 1·3·1.1 = 3.3
          { title: "UnknownImpact", dimId: "D1", impact: "weird" },  // weight 1 ⇒ 1·1·1.15 = 1.2
        ] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme");
    const byTitle = Object.fromEntries(recs!.map((r) => [r.title, r.leverage]));
    expect(byTitle.UnknownDim).toBe(3.3);
    expect(byTitle.UnknownImpact).toBe(1.2);
    for (const r of recs!) expect(Number.isFinite(r.leverage)).toBe(true); // no NaN slips through
  });

  it("respects the limit (slices the top-N after ranking)", async () => {
    mockGetPrisma.mockReturnValue(
      fakeRecPrisma([
        { name: "alpha", recs: [
          { title: "Top", dimId: "D1", impact: "high" },    // 3.5
          { title: "Mid", dimId: "D5", impact: "medium" },  // 1·2·1.09 = 2.2
          { title: "Low", dimId: "D1", impact: "low" },     // 1.2
        ] },
      ]) as never,
    );
    const recs = await getOrgRecommendations("acme", 2);
    expect(recs!.map((r) => r.title)).toEqual(["Top", "Mid"]); // top-2 by leverage, "Low" dropped
  });

  it("carries the recommendation's rationale + explore questions onto each org move (companion-voice parity)", async () => {
    // The org surface must be able to EXPLAIN a gap the way the repo report does. The rationale rides
    // through verbatim; the stored explore JSON is parsed via the shared parseStringArray (not a fork).
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme" })) },
      repository: {
        findMany: vi.fn(async () => [
          {
            name: "alpha",
            scans: [
              {
                archetype: "org",
                dimensions: [],
                recommendations: [
                  {
                    title: "Few tests vouch for behavior",
                    dimId: "D2",
                    impact: "high",
                    rationale: "Tests are the guardrail that makes AI-generated code safe to merge.",
                    explore: JSON.stringify([
                      "What would catch a regression before it merged?",
                      "Which critical behaviors have no test?",
                    ]),
                  },
                ],
              },
            ],
          },
        ]),
      },
    } as never);
    const recs = await getOrgRecommendations("acme");
    expect(recs![0].rationale).toContain("guardrail");
    expect(recs![0].explore).toEqual([
      "What would catch a regression before it merged?",
      "Which critical behaviors have no test?",
    ]);
  });
});

// ── Practice PR lifecycle projection (practices #1) ──────────────────────────
// Applying a practice opens real draft PRs into customer repos, and those PRs now ride the SAME
// ImprovementPr lifecycle the war room drives (merge poll + post-merge impact). getOrgPractices
// projects that back onto each practice row, so the page that offered the action can show what it
// put in motion. The fold is the load-bearing math: a miscount claims work that isn't in flight, and
// a mis-averaged lift is a number a lead reports upward.

describe("summarizePracticePrs — the per-practice PR fold", () => {
  const row = (o: Partial<Parameters<typeof summarizePracticePrs>[0][number]>) => ({
    practiceId: "ci-gates",
    repoFullName: "acme/app",
    prNumber: 1,
    prUrl: "https://github.com/acme/app/pull/1",
    state: "open",
    impactDim: null,
    ...o,
  });

  it("counts in-flight vs landed per practice and averages the MEASURED lift", () => {
    const s = summarizePracticePrs([
      row({ repoFullName: "acme/a" }),
      row({ repoFullName: "acme/b" }),
      row({ repoFullName: "acme/c", state: "merged", impactDim: 10 }),
      row({ repoFullName: "acme/d", state: "merged", impactDim: 20 }),
    ]);
    expect(s.get("ci-gates")!.prs).toEqual({ open: 2, merged: 2, lift: 15 });
  });

  it("keeps practices separate — one practice's rollout never bleeds into another's row", () => {
    const s = summarizePracticePrs([
      row({ practiceId: "ci-gates", repoFullName: "acme/a" }),
      row({ practiceId: "test-discipline", repoFullName: "acme/b", state: "merged", impactDim: 8 }),
    ]);
    expect(s.get("ci-gates")!.prs).toEqual({ open: 1, merged: 0, lift: null });
    expect(s.get("test-discipline")!.prs).toEqual({ open: 0, merged: 1, lift: 8 });
  });

  it("an awaiting-rescan merge does NOT drag the average toward zero (null ≠ no effect)", () => {
    // impactDim is null until the post-merge scan lands. Counting it as 0 would report "+4 avg" for a
    // practice that actually measured +8 on its only verified merge.
    const s = summarizePracticePrs([
      row({ repoFullName: "acme/a", state: "merged", impactDim: 8 }),
      row({ repoFullName: "acme/b", state: "merged", impactDim: null }),
    ]);
    expect(s.get("ci-gates")!.prs).toEqual({ open: 0, merged: 2, lift: 8 });
  });

  it("reports a regression honestly and rounds the average to a whole point", () => {
    const s = summarizePracticePrs([
      row({ repoFullName: "acme/a", state: "merged", impactDim: -3 }),
      row({ repoFullName: "acme/b", state: "merged", impactDim: 8 }),
      row({ repoFullName: "acme/c", state: "merged", impactDim: 1 }),
    ]);
    expect(s.get("ci-gates")!.prs.lift).toBe(2); // (−3 + 8 + 1)/3 = 2
  });

  it("a GitHub-CLOSED (rejected) PR is neither in flight nor landed, and never blocks a re-apply", () => {
    const s = summarizePracticePrs([row({ state: "closed" })]);
    expect(s.get("ci-gates")!.prs).toEqual({ open: 0, merged: 0, lift: null });
    expect(s.get("ci-gates")!.openPrs).toEqual([]);
  });

  it("lists ONLY open PRs per repo, with the coordinates the apply UI links", () => {
    const s = summarizePracticePrs([
      row({ repoFullName: "acme/a", prNumber: 7, prUrl: "u7" }),
      row({ repoFullName: "acme/b", prNumber: 9, prUrl: "u9", state: "merged", impactDim: 3 }),
    ]);
    expect(s.get("ci-gates")!.openPrs).toEqual([{ repoFullName: "acme/a", prNumber: 7, prUrl: "u7" }]);
  });

  it("no PR rows at all ⇒ no entry (the practice row shows no rollout chrome)", () => {
    expect(summarizePracticePrs([]).size).toBe(0);
  });
});

describe("getOrgPractices — PR lifecycle is folded into the projection", () => {
  function fakePracticePrisma(prRows: unknown[]) {
    const improvementPrFindMany = vi.fn(async () => prRows);
    return {
      prisma: {
        organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "prax" })) },
        repository: {
          findMany: vi.fn(async () => [
            { name: "app", fullName: "prax/app", scans: [{ dimensions: [{ dimId: "D3", score: 20 }] }] },
            { name: "api", fullName: "prax/api", scans: [{ dimensions: [{ dimId: "D3", score: 90 }] }] },
          ]),
        },
        improvementPr: { findMany: improvementPrFindMany },
      },
      improvementPrFindMany,
    };
  }

  const ciGates = async (slug: string) => {
    const all = await getOrgPractices(slug);
    return all!.find((p) => p.id === "ci-gates")!;
  };

  it("projects prs + openPrs onto the practice the PRs belong to, in ONE aggregate read (no N+1)", async () => {
    const { prisma, improvementPrFindMany } = fakePracticePrisma([
      { practiceId: "ci-gates", repoFullName: "prax/app", prNumber: 4, prUrl: "u4", state: "open", impactDim: null },
      { practiceId: "ci-gates", repoFullName: "prax/api", prNumber: 5, prUrl: "u5", state: "merged", impactDim: 12 },
    ]);
    mockGetPrisma.mockReturnValue(prisma as never);

    const p = await ciGates("prax-one");

    expect(p.prs).toEqual({ open: 1, merged: 1, lift: 12 });
    expect(p.openPrs).toEqual([{ repoFullName: "prax/app", prNumber: 4, prUrl: "u4" }]);
    // One org-scoped read for the WHOLE library — not one per practice (9) or per repo.
    expect(improvementPrFindMany).toHaveBeenCalledTimes(1);
  });

  it("leaves prs/openPrs UNDEFINED for a practice never applied — no rollout chrome on an untouched row", async () => {
    const { prisma } = fakePracticePrisma([]);
    mockGetPrisma.mockReturnValue(prisma as never);

    const all = await getOrgPractices("prax-two");
    expect(all!.every((p) => p.prs === undefined && p.openPrs === undefined)).toBe(true);
  });

  it("excludes PRs for repos outside the active segment/tech-group slice", async () => {
    // The repo projection is filtered; the PR read is org-wide, so the fold MUST be re-scoped or the
    // page would count PRs for repos the viewer filtered out.
    const { prisma } = fakePracticePrisma([
      { practiceId: "ci-gates", repoFullName: "prax/app", prNumber: 4, prUrl: "u4", state: "open", impactDim: null },
      { practiceId: "ci-gates", repoFullName: "prax/elsewhere", prNumber: 6, prUrl: "u6", state: "open", impactDim: null },
    ]);
    mockGetPrisma.mockReturnValue(prisma as never);

    const p = await ciGates("prax-three");

    expect(p.prs).toEqual({ open: 1, merged: 0, lift: null }); // prax/elsewhere is not in the slice
    expect(p.openPrs).toEqual([{ repoFullName: "prax/app", prNumber: 4, prUrl: "u4" }]);
  });
});

// ── Benchmark corpus eligibility ──────────────────────────────────────────────
// A percentile is a claim that two numbers came out of the same instrument. Before this filter the
// corpus was every other org's latest scan regardless of HOW it was produced, so `mock`-engine scans
// (the keyless/demo deterministic floor, which seeded demo orgs emit in bulk) and scans from a retired
// rubric version were ranked as peers — and the resulting percentile shipped in the Executive Briefing
// PDF and on /portfolio. These pin the eligibility predicate on BOTH sides of the comparison, because
// filtering only the corpus mirrors the same error onto this org's own numbers.
describe("getOrgBenchmark — corpus eligibility", () => {
  /** `rows` is what BOTH repository reads return — enough to get past the empty-corpus early return
   *  when we need to observe the second (this-org) query too. */
  function benchmarkPrisma(rows: unknown[] = []) {
    const calls: { where?: Record<string, unknown>; select?: Record<string, unknown> }[] = [];
    return {
      calls,
      prisma: {
        organization: { findUnique: vi.fn(async () => ({ id: "org_bench", slug: "benchco", plan: "enterprise" })) },
        repository: {
          findMany: vi.fn(async (args: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => {
            calls.push(args);
            return rows;
          }),
        },
      },
    };
  }

  const scoredRepo = (orgId: string, overall: number) => ({
    orgId,
    primaryLanguage: "TypeScript",
    scans: [{ overallScore: overall, adoptionScore: overall, rigorScore: overall }],
  });

  it("requires a non-mock engine and the CURRENT rubric version, on the corpus AND on this org", async () => {
    const { calls, prisma } = benchmarkPrisma([scoredRepo("org_other", 70)]);
    mockGetPrisma.mockReturnValue(prisma as never);
    await getOrgBenchmark("benchco");

    // Two reads: the cross-tenant corpus, then this org's own repos.
    expect(calls).toHaveLength(2);
    const eligible = { engineProvider: { not: "mock" }, rubricVersion: SCORING_RUBRIC_VERSION };

    // Corpus side: the `some` predicate spends the CORPUS_CAP budget on comparable repos, and the
    // per-repo `take: 1` picks the latest ELIGIBLE scan rather than the latest scan outright — so a
    // repo whose most recent run degraded to mock still contributes its last real measurement.
    const corpus = calls[0];
    expect((corpus.where as { scans: unknown }).scans).toEqual({ some: eligible });
    expect((corpus.select as { scans: { where: unknown } }).scans.where).toEqual(eligible);

    // This org's side: same instrument, or the comparison is meaningless in the other direction.
    expect((calls[1].select as { scans: { where: unknown } }).scans.where).toEqual(eligible);
  });

  it("returns the corpus basis alongside the numbers, even when the corpus is empty", async () => {
    // The basis has to travel WITH the percentile — a rank whose population is undisclosed is not an
    // auditable number, and the empty-corpus early return is the easiest place for it to get dropped.
    const { prisma } = benchmarkPrisma();
    mockGetPrisma.mockReturnValue(prisma as never);
    const b = await getOrgBenchmark("benchco");

    expect(b!.corpusRepos).toBe(0);
    expect(b!.overallPercentile).toBeNull(); // no corpus ⇒ no rank, never a hard 0/100
    expect(b!.corpusBasis).toEqual({ rubric: SCORING_RUBRIC_VERSION, excludesMockEngine: true });
  });
});
