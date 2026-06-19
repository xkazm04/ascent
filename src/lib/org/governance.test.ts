import { describe, it, expect, vi, beforeEach } from "vitest";

// The async assembler (buildGovernanceOverview) pulls its inputs from @/lib/db. Mock ONLY that
// boundary so the dedup / gap / sort / cap math runs for real over crafted rollups (the rest of the
// pipeline — evaluateGateLite, DIMENSION_BY_ID, PRACTICES — stays live, same as the renderer test).
const { mockGetOrgRollup, mockGetOrgGatePolicy } = vi.hoisted(() => ({
  mockGetOrgRollup: vi.fn(),
  mockGetOrgGatePolicy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getOrgRollup: mockGetOrgRollup,
  getOrgGatePolicy: mockGetOrgGatePolicy,
}));

import { buildGovernanceOverview, governanceMarkdown, type GovernanceOverview } from "./governance";
import { defaultGatePolicy, evaluateGateLite } from "@/lib/scoring/gate";

describe("evaluateGateLite", () => {
  const orgPolicy = defaultGatePolicy("org"); // { minLevel: L3, minDimension: 40, forbidPostures: [ungoverned] }

  it("reports every failing condition with the right codes", () => {
    const res = evaluateGateLite(
      { level: "L2", overall: 55, posture: "ungoverned", dims: [{ dimId: "D1", score: 30 }, { dimId: "D9", score: 70 }] },
      orgPolicy,
    );
    expect(res.pass).toBe(false);
    expect([...res.failures.map((f) => f.code)].sort()).toEqual(["dimension", "level", "posture"]);
    expect(res.failures.find((f) => f.code === "dimension")?.message).toContain("D1");
    expect(res.failures.find((f) => f.code === "dimension")?.message).toContain("30");
  });

  it("passes a repo that clears the org bar", () => {
    const res = evaluateGateLite(
      { level: "L4", overall: 82, posture: "governed", dims: [{ dimId: "D1", score: 61 }, { dimId: "D9", score: 75 }] },
      orgPolicy,
    );
    expect(res.pass).toBe(true);
    expect(res.failures).toHaveLength(0);
  });
});

const fixture: GovernanceOverview = {
  org: "acme",
  generatedOn: "2026-06-09",
  policyText: ["Minimum overall level L3", "Every dimension ≥ 40", 'No "ungoverned" posture'],
  scanned: 10,
  passing: 7,
  failing: 3,
  passRate: 70,
  byReason: { level: 2, overall: 0, dimension: 3, posture: 1, governance: 0 },
  failures: [
    {
      name: "web",
      fullName: "acme/web",
      level: "L2",
      overall: 48,
      reasons: ["Level L2 is below the required L3.", "D9 Supply Chain & Security scored 30, below the required 40."],
    },
  ],
  closestToGreen: [
    {
      name: "web",
      fullName: "acme/web",
      failCount: 2,
      gap: 10,
      dims: [{ dimId: "D9", name: "Supply Chain & Security", score: 30, floor: 40, gap: 10, practiceId: "supply-chain" }],
      blockers: ["Level L2 is below the required L3."],
    },
  ],
  gateQuery: "min_level=L3&min_dimension=40&no_ungoverned=1",
  ciWith: ["min-level: L3", "min-dimension: '40'", "no-ungoverned: 'true'"],
};

describe("governanceMarkdown", () => {
  const md = governanceMarkdown(fixture);

  it("states the policy and fleet status", () => {
    expect(md).toContain("## Policy (applied to every repo)");
    expect(md).toContain("- Minimum overall level L3");
    expect(md).toContain("7/10 repos PASS the gate (70%)");
    expect(md).toContain("Failing on: 2 below level · 3 dimension floor · 1 posture");
  });

  it("lists failing repos with their specific conditions", () => {
    expect(md).toContain("acme/web (L2, overall 48)");
    expect(md).toContain("Level L2 is below the required L3.");
  });

  it("includes the CI enforcement (same policy as the dashboard)", () => {
    expect(md).toContain("min_level=L3&min_dimension=40&no_ungoverned=1");
    expect(md).toContain("ascent-url: ${{ vars.ASCENT_URL }}");
    expect(md).toContain("min-level: L3");
    expect(md).toContain("no-ungoverned: 'true'");
  });

  it("ends with a cheapest-path-to-green ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/cheapest path/);
  });
});

// ── buildGovernanceOverview: the engine that PRODUCES the overview from a rollup ──────────────────
// Org policy = defaultGatePolicy("org") = { minLevel: L3, minDimension: 40, forbidPostures: [ungoverned] }.
// We craft a fleet so every code path is exercised: a clean pass, a multi-dimension fail (dedup), a
// single-condition near-miss (closest-to-green), and a level-only fail (a partial set of signals).

type RepoRow = {
  name: string;
  fullName: string;
  latest: { level: string; overall: number; posture: string; dims: { dimId: string; score: number }[] } | null;
};

// Only the fields buildGovernanceOverview reads off the rollup. Cast through unknown so we don't have
// to hand-build the full OrgRollup surface (avgOverall, trend, forecast, …) that the function ignores.
const rollupOf = (scannedCount: number, repos: RepoRow[]) =>
  ({ scannedCount, repos }) as unknown as Awaited<ReturnType<typeof import("@/lib/db").getOrgRollup>>;

const dims = (entries: Record<string, number>) =>
  Object.entries(entries).map(([dimId, score]) => ({ dimId, score }));

const PASS = (name: string): RepoRow => ({
  name,
  fullName: `acme/${name}`,
  // L4, all dims well above 40, governed → clears the org gate.
  latest: { level: "L4", overall: 80, posture: "governed", dims: dims({ D1: 70, D2: 70, D9: 70 }) },
});

describe("buildGovernanceOverview", () => {
  beforeEach(() => {
    mockGetOrgRollup.mockReset();
    mockGetOrgGatePolicy.mockReset();
    // No org-specific override → buildGovernanceOverview falls back to defaultGatePolicy("org").
    mockGetOrgGatePolicy.mockResolvedValue(null);
  });

  it("computes the green-path pass math over a crafted fleet (pass-rate, counts, sort, dedup)", async () => {
    const fleet: RepoRow[] = [
      PASS("clean"),
      // Fails 3 dimension floors (D1=10, D2=20, D9=30). Should count ONCE toward byReason.dimension.
      { name: "multi", fullName: "acme/multi", latest: { level: "L4", overall: 80, posture: "governed", dims: dims({ D1: 10, D2: 20, D9: 30 }) } },
      // Single condition, smallest gap: D1=39 → 1 point from the 40 floor. The cheapest repo to flip.
      { name: "tiny", fullName: "acme/tiny", latest: { level: "L4", overall: 80, posture: "governed", dims: dims({ D1: 39, D2: 70, D9: 70 }) } },
    ];
    mockGetOrgRollup.mockResolvedValue(rollupOf(3, fleet));

    const o = await buildGovernanceOverview("acme");
    expect(o).not.toBeNull();
    const ov = o!;

    // Green-path % math: 1 of 3 repos passes → 33% (rounded).
    expect(ov.scanned).toBe(3);
    expect(ov.passing).toBe(1);
    expect(ov.failing).toBe(2);
    expect(ov.passRate).toBe(33);

    // Per-reason DEDUP: "multi" fails 3 dimensions, "tiny" fails 1 → dimension counted per-repo, = 2 (NOT 4).
    expect(ov.byReason.dimension).toBe(2);
    expect(ov.byReason.level).toBe(0);
    expect(ov.byReason.posture).toBe(0);
    expect(ov.byReason.overall).toBe(0);

    // Closest-to-green: single-condition + smallest gap first → "tiny" (1 failing dim, gap 1) leads.
    expect(ov.closestToGreen[0].name).toBe("tiny");
    expect(ov.closestToGreen[0].failCount).toBe(1);
    expect(ov.closestToGreen[0].gap).toBe(1); // 40 - 39
    // …and its dim carries the real points-to-floor + the mapped practice (D1 → agent-guidance).
    expect(ov.closestToGreen[0].dims).toHaveLength(1);
    expect(ov.closestToGreen[0].dims[0]).toMatchObject({ dimId: "D1", score: 39, floor: 40, gap: 1, practiceId: "agent-guidance" });

    // "multi" gap = summed points-to-floor = (40-10)+(40-20)+(40-30) = 60.
    const multi = ov.closestToGreen.find((g) => g.name === "multi")!;
    expect(multi.failCount).toBe(3);
    expect(multi.gap).toBe(60);
    // Its dims are sorted by ascending gap (cheapest dimension first): D9(10) < D2(20) < D1(30).
    expect(multi.dims.map((d) => d.dimId)).toEqual(["D9", "D2", "D1"]);
  });

  it("collapses duplicate per-reason gaps so one repo's repeated gap isn't double-counted", async () => {
    // A single repo failing the SAME reason (dimension) three times must move byReason.dimension by 1.
    const fleet: RepoRow[] = [
      { name: "triple", fullName: "acme/triple", latest: { level: "L4", overall: 80, posture: "governed", dims: dims({ D1: 5, D2: 5, D9: 5 }) } },
    ];
    mockGetOrgRollup.mockResolvedValue(rollupOf(1, fleet));

    const ov = (await buildGovernanceOverview("acme"))!;
    // evaluateGateLite emits 3 "dimension" failures for this repo …
    expect(ov.failures[0].reasons.length).toBe(3);
    // … but the deduped fleet tally counts the repo ONCE per reason code.
    expect(ov.byReason.dimension).toBe(1);
    expect(ov.passRate).toBe(0);
    expect(ov.passing).toBe(0);
  });

  it("counts a partial repo only for the signals it actually presents", async () => {
    // This repo is fine on every dimension + posture and only misses on LEVEL (L2 < L3). It must
    // contribute exactly one level reason and zero dimension/posture/overall reasons.
    const fleet: RepoRow[] = [
      PASS("ok"),
      { name: "lowlevel", fullName: "acme/lowlevel", latest: { level: "L2", overall: 80, posture: "governed", dims: dims({ D1: 70, D2: 70, D9: 70 }) } },
    ];
    mockGetOrgRollup.mockResolvedValue(rollupOf(2, fleet));

    const ov = (await buildGovernanceOverview("acme"))!;
    expect(ov.byReason.level).toBe(1);
    expect(ov.byReason.dimension).toBe(0);
    expect(ov.byReason.posture).toBe(0);
    expect(ov.byReason.overall).toBe(0);
    // A level miss is a non-numeric blocker (no dim gap), so green-path gap is 0 with no dims.
    const item = ov.closestToGreen.find((g) => g.name === "lowlevel")!;
    expect(item.gap).toBe(0);
    expect(item.dims).toHaveLength(0);
    expect(item.blockers.length).toBe(1);
    expect(ov.passRate).toBe(50);
  });

  it("excludes repos that have no latest scan from the scanned set", async () => {
    const fleet: RepoRow[] = [PASS("scanned"), { name: "never", fullName: "acme/never", latest: null }];
    // rollup.scannedCount is non-zero (so we don't early-return), but only one repo has `latest`.
    mockGetOrgRollup.mockResolvedValue(rollupOf(1, fleet));

    const ov = (await buildGovernanceOverview("acme"))!;
    expect(ov.scanned).toBe(1); // the latest-less repo is filtered out
    expect(ov.passing).toBe(1);
    expect(ov.passRate).toBe(100);
  });

  it("returns null (the documented empty overview) for a null or zero-scanned fleet — no NaN, no crash", async () => {
    mockGetOrgRollup.mockResolvedValueOnce(null);
    expect(await buildGovernanceOverview("ghost")).toBeNull();

    mockGetOrgRollup.mockResolvedValueOnce(rollupOf(0, []));
    expect(await buildGovernanceOverview("empty")).toBeNull();
  });

  it("emits the Security (D9) floor + require-protection in the CI snippet AND gate URL (no drift)", async () => {
    // The dashboard policyText already shows these conditions; the COPYABLE CI snippet / gate URL must
    // carry them too, or the gate enforces a different (weaker) bar than the dashboard advertises.
    mockGetOrgGatePolicy.mockResolvedValue({
      minLevel: "L3",
      minDimension: 40,
      minDimensionFor: { D9: 50 },
      forbidPostures: ["ungoverned"],
      requireProtectedBranch: true,
    });
    mockGetOrgRollup.mockResolvedValue(rollupOf(1, [PASS("ok")]));

    const ov = (await buildGovernanceOverview("acme"))!;
    expect(ov.gateQuery).toContain("min_security=50");
    expect(ov.gateQuery).toContain("require_protection=1");
    expect(ov.ciWith).toContain("min-security: '50'");
    expect(ov.ciWith).toContain("require-protection: 'true'");
    expect(ov.policyText).toContain("Default branch must be protected");
    expect(ov.policyText.some((t) => /D9.*≥\s*50/.test(t))).toBe(true);
  });
});
