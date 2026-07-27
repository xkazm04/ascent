// The security "Copy for LLM" brief is a product contract — lock its shape: standing, distribution,
// governance coverage, the risk-register table (score, gate verdict, enabled branch rules per repo),
// and a trailing remediation ASK.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGateSnippet, securityMarkdown, type SecurityOverview } from "./security";

// `buildSecurityOverview` is pure assembly over two @/lib/db reads (rollup + governance). Mock the db
// boundary so we can drive the band math and the security-gate verdict directly. The real maturity
// model (DIMENSION_BY_ID → the D9 label) and the real DEFAULT_SECURITY_MIN stay un-mocked, so the
// band boundaries and the gate floor are asserted against production constants, not hand-typed copies.
vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgGovernance: vi.fn(),
  getOrgDimensionGaps: vi.fn(),
}));

const fixture: SecurityOverview = {
  org: "acme",
  periodTitle: "last 90 days",
  generatedOn: "2026-06-09",
  dimLabel: "Supply Chain & Security",
  avgSecurity: 48,
  securityDelta: null,
  scanned: 10,
  band: { critical: 2, weak: 3, ok: 4, strong: 1 },
  weakest: [
    { name: "legacy-api", fullName: "acme/legacy-api", score: 22, protected: false },
    { name: "web", fullName: "acme/web", score: 51, protected: true },
  ],
  governance: { repos: 10, protectedRate: 60, requireReviewRate: 50, requireChecksRate: 40, signedRate: 10 },
  unprotected: [{ name: "legacy-api", fullName: "acme/legacy-api" }],
  securityGate: {
    minSecurity: 50,
    passing: 5,
    failing: 5,
    failingRepos: [{ name: "legacy-api", fullName: "acme/legacy-api", score: 22, reason: "Security 22 < 50" }],
  },
  register: [
    { name: "legacy-api", fullName: "acme/legacy-api", score: 22, gateReason: "Security 22 < 50", rules: { protected: false, review: false, checks: false, signed: false }, checks: [], issues: ["No SAST configuration visible", "No SBOM generation evidenced"], summary: "Weak supply-chain posture." },
    { name: "web", fullName: "acme/web", score: 51, gateReason: null, rules: { protected: true, review: true, checks: false, signed: false }, checks: [], issues: [], summary: "" },
  ],
};

// security-posture-audit-log 2026-07-16 #4: the "paste-ready CI gate snippet" must cover EVERY
// gate-failing repo, not the display-capped securityGate.failingRepos (8) — an org with 20 failing
// repos previously copied a snippet that silently gated 8 of them.
describe("buildGateSnippet — exhaustive over the full register", () => {
  it("emits one curl per gate-failing repo even past the 8-repo display cap", () => {
    const failing = Array.from({ length: 12 }, (_, i) => ({
      name: `repo-${i}`,
      fullName: `acme/repo-${i}`,
      score: 20,
      gateReason: "Security 20 < 50",
      rules: null,
      checks: [],
      issues: [],
      summary: "",
    }));
    const o: SecurityOverview = {
      ...fixture,
      register: [...failing, { ...fixture.register[1]! }],
      securityGate: { ...fixture.securityGate, failing: 12, failingRepos: fixture.securityGate.failingRepos },
    };
    const snippet = buildGateSnippet(o);
    for (const r of failing) expect(snippet).toContain(`curl -sf "$ASCENT_URL/api/gate/${r.fullName}?security=1"`);
    // Passing repos are not gated into the snippet when there are failures.
    expect(snippet).not.toContain("acme/web?security=1");
  });

  it("falls back to two example lines when the whole fleet passes", () => {
    const o: SecurityOverview = {
      ...fixture,
      register: fixture.register.map((r) => ({ ...r, gateReason: null })),
    };
    const snippet = buildGateSnippet(o);
    expect(snippet).toContain("acme/legacy-api?security=1");
    expect(snippet).toContain("acme/web?security=1");
  });
});

describe("securityMarkdown — degraded supply chain is stated, never implied clean", () => {
  // getOrgSupplyChain returns { degraded: true, scanned: 0 } when the advisory fetch FAILED. The old
  // gate was `supply.scanned > 0`, so a degraded result rendered exactly like a clean one: the section
  // was simply omitted. A model handed that brief concludes the supply chain is fine and recommends
  // nothing. The brief must say it could not look.
  const degraded = { provider: "github", demo: false, degraded: true, scanned: 0, totals: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, repos: [] };

  it("emits an explicit UNKNOWN section when the advisory fetch failed", () => {
    const md = securityMarkdown(fixture, degraded as never);
    expect(md).toContain("## Supply chain — UNKNOWN");
    expect(md).toContain("not** evidence of a clean supply chain");
    // and must NOT render the normal advisory summary
    expect(md).not.toContain("Open advisories:");
  });

  it("omits the supply-chain section entirely when no supply data was requested", () => {
    const md = securityMarkdown(fixture);
    expect(md).not.toContain("## Supply chain");
  });
});

describe("securityMarkdown", () => {
  const md = securityMarkdown(fixture);

  it("summarizes standing, distribution and governance coverage", () => {
    expect(md).toContain("Average Security (Supply Chain & Security, D9): 48/100 across 10 repos");
    expect(md).toContain("2 critical (<40) · 3 weak (40–59) · 4 ok (60–79) · 1 strong (80+)");
    expect(md).toContain("Branch protection: 60% protected · 50% require review · 40% require checks · 10% signed");
  });

  it("renders the risk register table with gate verdict and enabled branch rules per repo", () => {
    expect(md).toContain("## Risk register (worst first)");
    expect(md).toContain("| legacy-api | 22/100 | FAIL — Security 22 < 50 | none |");
    expect(md).toContain("| web | 51/100 | pass | protected, review |");
    // No supply passed → no advisories column in the header.
    expect(md).toContain("| repo | security (D9) | gate | branch rules |");
    expect(md).not.toContain("advisories");
    expect(md).toContain("## Repos with no default-branch protection");
  });

  it("reports the security gate status", () => {
    expect(md).toContain('Policy: Security (D9) >= 50, no "ungoverned" posture');
    expect(md).toContain("5 of 10 repos FAIL the gate");
    expect(md).toContain("legacy-api: Security 22 < 50");
  });

  it("ends with a remediation ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/propose the top remediations/);
  });
});

// ---------------------------------------------------------------------------
// buildSecurityOverview — the JUDGMENT, not the formatter. securityMarkdown above
// only renders a pre-computed fixture; the band classification (<40/<60/<80/else)
// and the security-gate verdict (D9 < minSecurity OR posture==="ungoverned") are
// the actual business logic the Security tab shows and the LLM brief tells an agent
// to remediate. A boundary off-by-one (`<`→`<=`) or dropping the ungoverned arm would
// mis-report which repos FAIL security while the markdown test stayed green.
// (test-mastery-2026-06-18, finding #3 High / success-theater)
// ---------------------------------------------------------------------------

import { buildSecurityOverview } from "./security";
import { getOrgRollup, getOrgGovernance, getOrgDimensionGaps } from "@/lib/db";
import { DEFAULT_SECURITY_MIN } from "@/lib/scoring/gate";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";

const mockRollup = vi.mocked(getOrgRollup);
const mockGov = vi.mocked(getOrgGovernance);
const mockGaps = vi.mocked(getOrgDimensionGaps);

type Rollup = NonNullable<Awaited<ReturnType<typeof getOrgRollup>>>;
type RepoRow = Rollup["repos"][number];

// One scanned repo row carrying a D9 score + posture. `latest:null` models an
// unscanned repo (filtered out by buildSecurityOverview before banding).
function repo(name: string, d9: number | null, posture = "governed", scanned = true): RepoRow {
  return {
    fullName: `acme/${name}`,
    owner: "acme",
    name,
    isPrivate: false,
    watched: true,
    primaryLanguage: "TypeScript",
    scanSchedule: "weekly",
    lastScanAt: "2026-06-01T00:00:00.000Z",
    lastScanStatus: "ok",
    lastScanError: null,
    aiConformance: null,
    latest: scanned
      ? {
          level: "L3",
          overall: d9 ?? 0,
          adoption: 50,
          rigor: 50,
          posture,
          scannedAt: "2026-06-01T00:00:00.000Z",
          dims: d9 == null ? [] : [{ dimId: "D9", score: d9 }],
        }
      : null,
  } as RepoRow;
}

// Minimal OrgRollup; only the fields buildSecurityOverview reads matter. `repos` drives
// the band/gate math; `dimAverages` feeds avgSecurity; the rest is inert.
function rollup(repos: RepoRow[], over: Partial<Rollup> = {}): Rollup {
  return {
    org: "acme",
    repoCount: repos.length,
    scannedCount: repos.length,
    avgOverall: 60,
    avgAdoption: 50,
    avgRigor: 50,
    postureCounts: {},
    dimAverages: [{ dimId: "D9", avg: 55 }],
    repos,
    trend: [],
    forecast: null,
    baseline: null,
    deltas: null,
    ...over,
  } as Rollup;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGov.mockResolvedValue(null); // default: no governance data; individual tests override.
  mockGaps.mockResolvedValue(null); // default: no per-repo D9 findings; individual tests override.
});

describe("buildSecurityOverview — null / empty fleet", () => {
  it("returns null when the rollup is null (no org / nothing scanned)", async () => {
    mockRollup.mockResolvedValue(null);
    expect(await buildSecurityOverview("acme")).toBeNull();
  });

  it("returns null when the rollup exists but scannedCount is 0", async () => {
    mockRollup.mockResolvedValue(rollup([], { scannedCount: 0 }));
    expect(await buildSecurityOverview("acme")).toBeNull();
  });

  it("does not crash or NaN on a rollup whose repos are all unscanned (latest:null)", async () => {
    // scannedCount>0 keeps us past the early return, but every repo lacks `latest` so all are filtered.
    mockRollup.mockResolvedValue(rollup([repo("a", null, "governed", false)], { scannedCount: 1 }));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o).not.toBeNull();
    expect(o.scanned).toBe(0);
    expect(o.band).toEqual({ critical: 0, weak: 0, ok: 0, strong: 0 });
    expect(o.securityGate.passing).toBe(0);
    expect(o.securityGate.failing).toBe(0);
    expect(Number.isNaN(o.securityGate.passing)).toBe(false);
  });

  it("avgSecurity is null (not NaN) when no D9 dimension average exists", async () => {
    mockRollup.mockResolvedValue(rollup([repo("a", 70)], { dimAverages: [{ dimId: "D2", avg: 80 }] }));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.avgSecurity).toBeNull();
  });
});

describe("buildSecurityOverview — band classification at each boundary", () => {
  // Boundaries: <40 critical, 40–59 weak, 60–79 ok, 80+ strong. Pin each side of every cut point.
  it("buckets repos by the <40 / <60 / <80 / else cut points (boundary-exact)", async () => {
    mockRollup.mockResolvedValue(
      rollup([
        repo("c0", 0), // critical
        repo("c39", 39), // critical (39 < 40)
        repo("w40", 40), // weak  (40 is NOT critical — boundary)
        repo("w59", 59), // weak  (59 < 60)
        repo("ok60", 60), // ok    (60 is NOT weak — boundary)
        repo("ok79", 79), // ok    (79 < 80)
        repo("s80", 80), // strong (80 is NOT ok — boundary)
        repo("s100", 100), // strong
      ]),
    );
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.band).toEqual({ critical: 2, weak: 2, ok: 2, strong: 2 });
    expect(o.scanned).toBe(8);
    // Every scanned repo lands in exactly one band — no repo lost/double-counted.
    const total = o.band.critical + o.band.weak + o.band.ok + o.band.strong;
    expect(total).toBe(o.scanned);
  });

  it("treats a missing D9 dim score as 0 → critical band (fail-closed, not silently strong)", async () => {
    mockRollup.mockResolvedValue(rollup([repo("nodim", null)]));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.band.critical).toBe(1);
    expect(o.weakest[0].score).toBe(0);
  });
});

describe("buildSecurityOverview — security gate verdict (THE judgment)", () => {
  const minSecurity = DEFAULT_SECURITY_MIN; // 50, from production — not a magic number copy.

  it("a repo at EXACTLY minSecurity PASSES (predicate is strict `<`, not `<=`)", async () => {
    mockRollup.mockResolvedValue(rollup([repo("edge", minSecurity)]));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.securityGate.minSecurity).toBe(minSecurity);
    expect(o.securityGate.failing).toBe(0); // 50 is NOT < 50
    expect(o.securityGate.passing).toBe(1);
    expect(o.securityGate.failingRepos).toEqual([]);
  });

  it("a repo one point below minSecurity FAILS with a score reason", async () => {
    mockRollup.mockResolvedValue(rollup([repo("low", minSecurity - 1)]));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.securityGate.failing).toBe(1);
    expect(o.securityGate.passing).toBe(0);
    expect(o.securityGate.failingRepos[0]).toMatchObject({
      name: "low",
      score: minSecurity - 1,
      reason: `Security ${minSecurity - 1} < ${minSecurity}`,
    });
  });

  it("DEGRADES HONESTLY: an ungoverned-posture repo FAILS even with a high D9 score", async () => {
    // The dangerous regression is dropping the `posture === "ungoverned"` arm: a repo with weak
    // governance but a strong D9 score would then be greenlit as secure. Pin that it fails.
    mockRollup.mockResolvedValue(rollup([repo("heavy-ai", 90, "ungoverned")]));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.securityGate.failing).toBe(1);
    expect(o.band.strong).toBe(1); // it IS a strong-D9 repo by band...
    expect(o.securityGate.failingRepos[0]).toMatchObject({
      name: "heavy-ai",
      score: 90,
      reason: "ungoverned posture", // NOT a "score < min" reason — the posture arm fired
    });
  });

  it("passing + failing === scanned across a mixed fleet (no double-count, no drop)", async () => {
    mockRollup.mockResolvedValue(
      rollup([
        repo("ok", 70), // passes
        repo("edge", 50), // passes (== min)
        repo("low", 30), // fails: score
        repo("ungov", 88, "ungoverned"), // fails: posture
      ]),
    );
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.securityGate.passing).toBe(2);
    expect(o.securityGate.failing).toBe(2);
    expect(o.securityGate.passing + o.securityGate.failing).toBe(o.scanned);
    const reasons = Object.fromEntries(o.securityGate.failingRepos.map((r) => [r.name, r.reason]));
    expect(reasons.low).toBe(`Security 30 < ${minSecurity}`);
    expect(reasons.ungov).toBe("ungoverned posture");
  });

  it("the D9 label is the real production dimension name, not a hand-typed string", async () => {
    mockRollup.mockResolvedValue(rollup([repo("a", 70)]));
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.dimLabel).toBe(DIMENSION_BY_ID.D9?.name ?? "Security");
  });
});

describe("buildSecurityOverview — risk register", () => {
  it("covers every scanned repo, gate-failing first then weakest-first, and agrees with the gate", async () => {
    mockRollup.mockResolvedValue(
      rollup([
        repo("strong", 90), // passes — sorts last
        repo("edge", 50), // passes (== min)
        repo("low", 30), // fails: score
        repo("ungov", 88, "ungoverned"), // fails: posture — after "low" (weakest-first within failing)
      ]),
    );
    const o = (await buildSecurityOverview("acme"))!;
    expect(o.register.map((r) => r.name)).toEqual(["low", "ungov", "edge", "strong"]);
    expect(o.register.filter((r) => r.gateReason).length).toBe(o.securityGate.failing);
    expect(o.register[0].gateReason).toBe(`Security 30 < ${DEFAULT_SECURITY_MIN}`);
    expect(o.register[1].gateReason).toBe("ungoverned posture");
  });

  it("joins per-repo governance rules (approval-required semantics) and degrades to null when unreadable", async () => {
    mockRollup.mockResolvedValue(rollup([repo("a", 70), repo("b", 60)]));
    mockGov.mockResolvedValue({
      repos: 1,
      protectedRate: 100,
      requireReviewRate: 0,
      requireChecksRate: 100,
      signedRate: 0,
      perRepo: [
        // requiredApprovals 0 must read as review:false even with requiresPullRequest semantics upstream.
        { fullName: "acme/a", name: "a", protected: true, requiresPullRequest: true, requiredApprovals: 0, requiresStatusChecks: true, requiresSignatures: false, ruleCount: 2 },
      ],
    });
    const o = (await buildSecurityOverview("acme"))!;
    const byName = Object.fromEntries(o.register.map((r) => [r.name, r]));
    expect(byName.a.rules).toEqual({ protected: true, review: false, checks: true, signed: false });
    expect(byName.b.rules).toBeNull(); // no governance row for b — unknown, not "all off"
  });

  it("joins each repo's D9 findings (gaps + parsed checks + summary) onto its row; missing → empty", async () => {
    mockRollup.mockResolvedValue(rollup([repo("a", 40), repo("b", 30)]));
    mockGaps.mockResolvedValue(
      new Map([
        [
          "acme/a",
          {
            fullName: "acme/a",
            gaps: ["Add CodeQL scanning that runs on pull_request."],
            evidence: ["SAST [posture/medium]: 0/10 — No SAST wired into CI.", "Branch protection [posture/high]: 9/10 — Default branch: protected, 2 approvals.", "Known vulnerabilities [exposure/high]: n/a/10 — not inspected."],
            summary: "Weak posture.",
          },
        ],
        // b intentionally absent → its row must degrade to no findings, not throw.
      ]),
    );
    const o = (await buildSecurityOverview("acme"))!;
    const byName = Object.fromEntries(o.register.map((r) => [r.name, r]));
    expect(byName.a.issues).toEqual(["Add CodeQL scanning that runs on pull_request."]);
    expect(byName.a.summary).toBe("Weak posture.");
    // The evidence lines parse into structured, graded checks (posture + exposure, n/a preserved).
    expect(byName.a.checks.find((c) => c.name === "SAST")).toMatchObject({ score: 0, group: "posture" });
    expect(byName.a.checks.find((c) => c.name === "Branch protection")).toMatchObject({ score: 9 });
    expect(byName.a.checks.find((c) => c.name === "Known vulnerabilities")).toMatchObject({ score: null, group: "exposure" });
    expect(byName.b.issues).toEqual([]);
    expect(byName.b.checks).toEqual([]);
  });
});
