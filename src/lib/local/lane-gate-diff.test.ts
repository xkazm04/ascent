// THE GUARD'S OWN GUARD.
//
// This repo has been bitten exactly once by a source-scanning check that stopped matching and kept
// passing (AGENTS.md, 2026-09-04: `id-routes-gated.test.ts` was satisfied by the COMMENTS that named
// a gate after the gate itself had been deleted). A classifier is the same hazard in a different
// shape: loosen a rule and the guard reports a clean lane in a voice indistinguishable from "nothing
// was touched".
//
// So SEEDED_VIOLATIONS below is pinned. Every path in it MUST be classified, with the class stated.
// Loosening the classifier does not make this file quieter — it makes it RED.

import { describe, expect, it } from "vitest";
import { checkGateDiff, classifyScoringSurface, type ScoringSurface } from "@/lib/local/lane-gate-diff";

/** The pinned seed. A future edit that narrows a rule fails here, by name. */
const SEEDED_VIOLATIONS: { path: string; surface: ScoringSurface }[] = [
  // ── test files, by name, in the shapes this loop's target repos actually use
  { path: "src/lib/local/lane-gate-diff.test.ts", surface: "test-file" },
  { path: "src/components/report/ScoreWaterfall.spec.tsx", surface: "test-file" },
  { path: "src/lib/local/loop-lane.dry.test.ts", surface: "test-file" },
  { path: "scripts/docs/__tests__/check-doc-sync.test.mjs", surface: "test-file" },
  { path: "e2e/pricing.smoke.ts", surface: "test-file" },
  { path: "tests/api/org.ts", surface: "test-file" },
  { path: "app/core/test_scoring.py", surface: "test-file" },
  { path: "internal/engine/engine_test.go", surface: "test-file" },
  // ── fixtures: the quietest version of the move — no assertion is edited at all
  { path: "src/lib/local/__fixtures__/lane-envelope.json", surface: "fixture" },
  { path: "src/lib/report/__snapshots__/compare.test.ts.snap", surface: "fixture" },
  { path: "test/fixtures/scan-golden.json", surface: "fixture" },
  { path: "src/lib/__mocks__/prisma.ts", surface: "fixture" },
  { path: "reference-data/testdata/repo.json", surface: "fixture" },
  // ── the gate's own configuration: green over unchanged code
  { path: "vitest.config.js", surface: "gate-config" },
  { path: "playwright.loop.config.ts", surface: "gate-config" },
  { path: "eslint.config.mjs", surface: "gate-config" },
  { path: "tsconfig.json", surface: "gate-config" },
  { path: ".github/workflows/ci.yml", surface: "gate-config" },
  { path: ".husky/pre-commit", surface: "gate-config" },
  { path: "pyproject.toml", surface: "gate-config" },
  // ── the verify command itself, wherever this repo's resolver reads it from (lane-verify.ts)
  { path: "package.json", surface: "verify-command" },
  { path: ".ai/manifest.yaml", surface: "verify-command" },
  { path: "AGENTS.md", surface: "verify-command" },
  { path: "CLAUDE.md", surface: "verify-command" },
  { path: "Makefile", surface: "verify-command" },
  { path: "scripts/verify-gate.mjs", surface: "verify-command" },
];

/** Ordinary source. A lane that only changed these is NOT void, or the guard is useless. */
const INNOCENT = [
  "src/lib/local/lane-gate-diff.ts",
  "src/lib/local/compare-metrics.ts",
  "src/features/standing/overview/OverviewPanel.tsx",
  "src/app/api/scan/route.ts",
  "prisma/schema.prisma",
  "docs/features/org-planning/plan.md",
  "README.md",
  "next.config.ts",
  "package-lock.json",
  "src/lib/report/compare.ts",
];

describe("classifyScoringSurface", () => {
  it.each(SEEDED_VIOLATIONS)("catches $path as $surface", ({ path, surface }) => {
    expect(classifyScoringSurface(path)).toBe(surface);
  });

  it.each(INNOCENT)("leaves ordinary source alone: %s", (path) => {
    expect(classifyScoringSurface(path)).toBeNull();
  });

  it("matches on shape, not on a hardcoded path — a renamed directory is still caught", () => {
    // The whole reason this is a classifier: none of these paths exists in this repo today.
    expect(classifyScoringSurface("packages/core/src/deeply/nested/thing.test.ts")).toBe("test-file");
    expect(classifyScoringSurface("some/renamed/place/__fixtures__/a.json")).toBe("fixture");
    expect(classifyScoringSurface("apps/web/vitest.config.mts")).toBe("gate-config");
  });

  it("normalizes separators and case, so a Windows-built path is not a blind spot", () => {
    expect(classifyScoringSurface("src\\lib\\local\\foo.test.ts")).toBe("test-file");
    expect(classifyScoringSurface("./Package.json")).toBe("verify-command");
    expect(classifyScoringSurface("")).toBeNull();
  });
});

describe("checkGateDiff", () => {
  it("voids a lane that edited a test file, and names the path in the reason", () => {
    const v = checkGateDiff(["src/lib/scoring/engine.ts", "src/lib/scoring/engine.test.ts"]);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("src/lib/scoring/engine.test.ts");
    expect(v.reason).toContain("test-file");
    expect(v.paths).toEqual(["src/lib/scoring/engine.test.ts"]);
  });

  it("does not void a lane that edited only source", () => {
    expect(checkGateDiff(["src/lib/scoring/engine.ts", "src/app/api/gate/route.ts"])).toEqual({
      void: false,
      reason: null,
      paths: [],
    });
  });

  it("a lane with NO commits is not void — it simply never rescans", () => {
    expect(checkGateDiff([]).void).toBe(false);
  });

  it("voids on every seeded violation, one path at a time", () => {
    for (const { path } of SEEDED_VIOLATIONS) {
      const v = checkGateDiff([path]);
      expect(v.void, `a lane that committed ${path} must be void`).toBe(true);
      expect(v.reason).toContain(path);
    }
  });

  it("bounds the printed paths but counts the rest rather than hiding them", () => {
    const many = Array.from({ length: 11 }, (_, i) => `src/a${i}.test.ts`);
    const v = checkGateDiff(many);
    expect(v.paths).toHaveLength(6);
    expect(v.reason).toContain("+5 more paths");
  });

  it("ignores blank and non-string entries rather than crashing on a git quirk", () => {
    expect(checkGateDiff(["", "   ", null as unknown as string]).void).toBe(false);
  });
});
