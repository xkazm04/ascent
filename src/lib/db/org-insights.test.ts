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

import { percentileOf, getOrgMovers } from "@/lib/db/org-insights";
import { getOrgRollup } from "@/lib/db/org-rollup";

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
// The critical, previously-untested seam (test-mastery-2026-06-18, fleet-rollups-insights #1): the
// period-window BASELINE selection differs by ONE boundary operator between the two flagship surfaces.
//   movers  : prev = arr.find((s) => s.scannedAt <= start) ?? earliest-in-window  (INCLUSIVE of start)
//   rollup  : baseline cohort = scans with scannedAt { lt: start }                (STRICT, excludes start)
// These tests drive the REAL functions through a crafted prisma so the boundary, onboarded-mid-window,
// and self-compare cases are pinned — and the intended asymmetry at exactly `start` is locked as KNOWN
// so any future reconciliation is a deliberate, test-breaking change rather than a silent drift.

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
function fakeOrgPrisma(repos: FakeRepo[], scans: FakeScan[]) {
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
      findUnique: vi.fn(async () => ({ id: orgId, slug: "acme" })),
    },
    scan: {
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

  it("KNOWN ASYMMETRY: a repo whose only pre-or-at-start scan is EXACTLY at `start` — movers picks it as baseline, rollup EXCLUDES it (lt vs lte)", async () => {
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

    // MOVERS: prev = first scan with scannedAt <= start (INCLUSIVE) = the 60 at start.
    // So movers reports alpha +15 (75 - 60).
    expect(movers!.gainers).toHaveLength(1);
    expect(movers!.gainers[0]).toMatchObject({ name: "alpha", dOverall: 15 });

    // ROLLUP: baseline cohort is scans STRICTLY < start. The at-start scan is excluded, and there is
    // no other prior scan, so alpha is NOT in the baseline cohort at all -> no baseline, no deltas.
    // This is the documented half-open boundary asymmetry. Locking BOTH sides so a future
    // reconciliation (e.g. aligning movers to strict `<`) is a deliberate, test-breaking change.
    expect(rollup!.baseline).toBeNull();
    expect(rollup!.deltas).toBeNull();
  });

  it("a scan EXACTLY at `start` that is also the repo's latest does NOT self-compare (delta 0 -> no spurious move)", async () => {
    // r1's single scan sits exactly at start. Movers: now === prev (same row) -> skipped, no move.
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
    // repo does NOT manufacture a fake fleet climb in the headline tile. KNOWN, intended asymmetry.
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
    // strict `> 0` / `< 0` partition keeps a 0-delta repo out of both buckets.
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
