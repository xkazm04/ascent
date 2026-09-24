// Backlog develop-2026-09-17 row 28: HOLD the CI and security ordinals when the workflow content was
// not read. `workflowsUnread` already demotes the FINDINGS to `prod.ci-unassessable` /
// `prod.security-unassessable` (info). The ordinals kept scoring off the partial `workflowText`, so a
// tree whose workflows were never read listed as CI `build` (20 pts) and security `none` (0 pts), and
// the production score priced OUR bounded fetch as THEIR weak pipeline. The fix reads the coverage
// fact once (`isRungHeld`) and every consumer of the ordinal goes through it: the score renormalizes
// over the axes it did measure, the rung reads unassessable, and the autonomy ladder names the re-scan
// instead of proposing a CI fix nobody can see is needed.
//
// Fixtures: a repo whose OTHER axes are real (vitest + D2 70 = tests substantial 75; @sentry = errors
// 60; versioned prisma migrations = 50) so a held axis visibly moves the score. Held: CI 25% and
// security 20% drop out, so score = round((0.25*75 + 0.15*60 + 0.15*50) / 0.55) = round(64.09) = 64.
// Scored low (before): 0.25*20 + 0.25*75 + 0 + 9 + 7.5 = 40.25 = 40.

import { describe, it, expect } from "vitest";
import { applyPassportOverrides, buildPassport } from "@/lib/analyze/passport";
import { deriveProductionScore, isRungHeld, levelOrHeld } from "@/lib/analyze/passport-score";
import { productionRungViews } from "@/lib/org/passport-display";
import type { Governance, RepoMeta, RepoSnapshot, ScanReport } from "@/lib/types";

type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "commits" | "coverage">;
type F = { path: string; content: string; bytes: number };
const meta = (): RepoMeta => ({ owner: "acme", name: "web", url: "https://github.com/acme/web", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript" });
const report = (governance: Governance | null = null): ScanReport =>
  ({
    repo: meta(),
    overallScore: 50,
    level: { id: "L3", name: "x", band: [45, 64], tagline: "", description: "" },
    archetype: "team",
    confidence: 0.8,
    dimensions: [{ id: "D2", score: 70 }],
    techStack: undefined,
    governance,
    prStats: null,
    scannedAt: "2026-09-24T12:00:00Z",
  }) as unknown as ScanReport;
const enforced: Governance = {
  defaultBranch: "main", protected: true, requiresPullRequest: true, requiredApprovals: 1, requiresCodeOwnerReview: false,
  requiresStatusChecks: true, requiresSignatures: false, linearHistory: false, ruleCount: 1, readable: true,
};

const PKG = JSON.stringify({ scripts: { test: "vitest" }, dependencies: { "@sentry/node": "1", "@prisma/client": "1" }, devDependencies: { vitest: "1" } });
const WF = ".github/workflows/ci.yml";
const BUILD_WF = "name: ci\njobs:\n  build:\n    steps:\n      - run: npm run build\n";
const CHECKS_WF = "name: ci\njobs:\n  check:\n    steps:\n      - run: npm test\n";
const BASE_TREE = ["package.json", "CLAUDE.md", "prisma/migrations/001/migration.sql"];
const file = (path: string, content: string, bytes = content.length): F => ({ path, content, bytes });

function snap(workflows: string[], files: F[]): Snap {
  return {
    meta: meta(),
    tree: [...BASE_TREE, ...workflows].map((p) => ({ path: p, type: "blob" as const })),
    files: [file("package.json", PKG), ...files],
    commits: [],
    coverage: 1,
  };
}

const UNREAD: [string, Snap][] = [
  ["unread (listed, none fetched)", snap([WF], [])],
  ["partial (three listed, one read)", snap([WF, ".github/workflows/release.yml", ".github/workflows/audit.yml"], [file(WF, BUILD_WF)])],
  ["truncated (the one read was cut at its cap)", snap([WF], [file(WF, BUILD_WF, BUILD_WF.length + 4096)])],
];

describe("unread workflow content HOLDS the CI and security ordinals", () => {
  it.each(UNREAD)("%s: CI and security are held, not scored low", (_name, s) => {
    const pr = buildPassport(report(), s).productionReadiness;
    expect(isRungHeld("ci", pr.ci.level, pr.findings)).toBe(true);
    expect(isRungHeld("security", pr.security.level, pr.findings)).toBe(true);
    // The held axes drop out and the rest renormalize: 64 (beta), not the 40 a `build`/`none` scores.
    expect(pr.score).toBe(64);
    expect(pr.band).toBe("beta");
    const views = Object.fromEntries(productionRungViews(pr).map((v) => [v.id, v]));
    expect(views.ci.honesty).toBe("unassessable");
    expect(views.security.honesty).toBe("unassessable");
    expect(levelOrHeld("ci", pr.ci.level, pr.findings)).toBe("unassessable");
  });

  it("a rollback override re-derives over the same measured axes, so the hold survives the overlay", () => {
    const pp = applyPassportOverrides(buildPassport(report(), UNREAD[0][1]), { rollback: true });
    // (0.25*75 + 0.15*60 + 0.15*75) / 0.55 = 70.9
    expect(pp.productionReadiness.score).toBe(71);
    expect(pp.productionReadiness.overridden?.measuredScore).toBe(64);
  });

  it("the autonomy ladder names the re-scan, not a CI fix, when enforcement is visible but CI is held", () => {
    const pp = buildPassport(report(enforced), UNREAD[0][1]);
    expect(pp.autonomy?.tier).toBe("T1");
    const t2 = pp.autonomy?.unlocks.find((u) => u.tier === "T2");
    expect(t2?.ids).toContain("ci-unassessable");
    expect(t2?.ids).not.toContain("t2.ci-gated");
    expect(t2?.missing.some((m) => /did not read the workflow files in full/i.test(m))).toBe(true);
    expect(pp.autonomy?.inputs.ciHeld).toBe(true);
  });
});

describe("guard: an observed rung keeps its measured score", () => {
  it("guard: every workflow read whole, build-only: build is measured and scored (40), not held", () => {
    const pr = buildPassport(report(), snap([WF], [file(WF, BUILD_WF)])).productionReadiness;
    expect(pr.ci.level).toBe("build");
    expect(isRungHeld("ci", pr.ci.level, pr.findings)).toBe(false);
    expect(isRungHeld("security", pr.security.level, pr.findings)).toBe(false);
    expect(pr.score).toBe(40);
    expect(levelOrHeld("ci", pr.ci.level, pr.findings)).toBe("build");
  });

  it("guard: no workflows listed is an observed absence: CI none, scored, not held", () => {
    const pr = buildPassport(report(), snap([], [])).productionReadiness;
    expect(pr.ci.level).toBe("none");
    expect(isRungHeld("ci", pr.ci.level, pr.findings)).toBe(false);
    expect(pr.score).toBe(35);
  });

  it("a partial read that SAW checks keeps checks as a measured lower bound; only security is held", () => {
    const pr = buildPassport(report(), snap([WF, ".github/workflows/release.yml"], [file(WF, CHECKS_WF)])).productionReadiness;
    expect(pr.ci.level).toBe("checks");
    expect(isRungHeld("ci", pr.ci.level, pr.findings)).toBe(false);
    expect(isRungHeld("security", pr.security.level, pr.findings)).toBe(true);
    // (0.25*45 + 0.25*75 + 0.15*60 + 0.15*50) / 0.8 = 58.1
    expect(pr.score).toBe(58);
  });

  it("guard: a read-whole enforced build-only CI stays a measured CI fix on the autonomy ladder", () => {
    const pp = buildPassport(report(enforced), snap([WF], [file(WF, BUILD_WF)]));
    const t2 = pp.autonomy?.unlocks.find((u) => u.tier === "T2");
    expect(t2?.ids).toContain("t2.ci-gated");
    expect(t2?.ids).not.toContain("ci-unassessable");
    expect(pp.autonomy?.inputs).not.toHaveProperty("ciHeld");
  });

  it("guard: with no coverage finding the score is the unchanged weighted sum", () => {
    const sub = {
      ci: { level: "build" as const, provider: null, gates: [] },
      tests: { level: "substantial" as const, coveragePct: null, frameworks: [], criticalPathCovered: true },
      security: { level: "none" as const, tools: [] },
      observability: { level: "errors" as const },
      delivery: { migrations: "versioned" as const, iac: false, rollback: false },
    };
    expect(deriveProductionScore(sub).score).toBe(40);
  });
});
