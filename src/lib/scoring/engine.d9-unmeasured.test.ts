// A D9 battery with nothing it can measure is UNMEASURED, not 0.
//
// Measured 2026-10-05 on three real local scans (garden-vr, mage-arena, firetv — all D9 = 0): a
// worktree reading of a repo with no `.github/workflows` and no Dockerfile leaves every security
// check n/a, the battery's posture fell to 0 for want of a denominator, and the overall carried that 0
// as if it were a measured absence. These drive the REAL pipeline (detectors -> folds -> battery ->
// engine) so the claim is pinned end-to-end: blind + nothing gradable drops D9 and renormalizes;
// blind + a workflow, and a token scan of the same empty repo, are measured exactly as before.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { assembleReport } from "./engine";
import { buildAssessmentPrompt } from "./prompt";
import { overallScoreFor } from "@/lib/maturity/model";
import { dimensionObservability, unmeasurablePlatformDims } from "@/lib/analyze/platform-carry";
import { buildScanScoreInput } from "@/lib/scan-score-input";
import type { LlmAssessment, RepoSnapshot } from "@/lib/types";

const NOW = "2026-10-05T00:00:00.000Z";

function snap(files: { path: string; content: string }[]): RepoSnapshot {
  return {
    meta: { owner: "acme", name: "garden", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}

// A game repo shaped like the measured ones: guidance, tests, lint and docs — but no CI and no
// container files, so the security battery has nothing on disk to grade. Enough elsewhere that the
// overall is far from 0, so a phantom D9 = 0 visibly drags it.
const BARE = [
  { path: "README.md", content: "# Garden\nA VR garden.\n\n## Setup\nnpm install\n\n## Testing\nnpm test\n" },
  { path: "CLAUDE.md", content: "# Agent guide\n## Commands\nnpm test\n## Conventions\nTypeScript strict.\n" },
  { path: "AGENTS.md", content: "# Agents\nRun `npm test` before committing. Keep modules small.\n" },
  { path: "package.json", content: JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." }, devDependencies: { vitest: "1", eslint: "9", typescript: "5" } }) },
  { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { strict: true } }) },
  { path: "eslint.config.js", content: "export default [];\n" },
  { path: "src/main.ts", content: "export const x = 1;\n" },
  { path: "src/main.test.ts", content: "import { x } from './main';\ntest('x', () => expect(x).toBe(1));\n" },
  { path: "docs/architecture.md", content: "# Architecture\nOne module.\n" },
];
const WORKFLOW = { path: ".github/workflows/ci.yml", content: "on: [push]\npermissions:\n  contents: read\njobs: {}\n" };

/** A model answer that writes a D9 row and a D1 row — the D9 one must not survive an unmeasured D9. */
const model: LlmAssessment = {
  dimensions: [],
  headline: "",
  strengths: [],
  risks: [],
  roadmap: [
    { title: "A security policy would give reporters a path", dimension: "D9", impact: "medium", effort: "low", rationale: "r", explore: [] },
    { title: "Agent guidance would orient contributors", dimension: "D1", impact: "high", effort: "low", rationale: "r", explore: [] },
  ],
  discrepancies: [],
};

async function scan(files: { path: string; content: string }[], blind: boolean) {
  const s = snap(files);
  const built = await buildScanScoreInput({
    snapshot: s,
    prStats: null,
    governance: null,
    securityPosture: null,
    securityExposure: null,
    now: NOW,
    platformSignalsUnobservable: blind,
  });
  const report = assembleReport(s, built.signals, model, { name: "mock", model: "m" }, NOW, built.archetype, null, built.platformSignals);
  return { built, report };
}

beforeEach(() => {
  vi.stubEnv("TECH_STACK_PROMPT", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("D9 on a blind reading with nothing gradable", () => {
  it("is dropped from the score, named on scoreIntegrity, and the overall renormalized", async () => {
    const { built, report } = await scan(BARE, true);

    expect(built.scoreInput.securityAssessment?.unmeasured).toBe(true);
    expect(report.dimensions.map((d) => d.id)).not.toContain("D9");
    expect(report.scoreIntegrity!.unmeasuredDims).toEqual(["D2", "D3", "D4", "D9"]);
    // Not the prose hatch: nothing the model said caused this.
    expect(report.scoreIntegrity!.d9Unmeasurable).toBe(false);
    // The overall is the renormalized mean over what WAS measured — and the phantom-0 computation
    // (the pre-fix number) is a different, lower one.
    expect(report.overallScore).toBe(overallScoreFor(report.dimensions, report.archetype));
    const phantom = overallScoreFor([...report.dimensions, { id: "D9", score: 0 }], report.archetype);
    expect(phantom).toBeLessThan(report.overallScore);
    expect(report.warnings?.some((w) => w.includes("Security (D9) was NOT MEASURED"))).toBe(true);
  });

  it("mints no D9 follow-up from either the model's roadmap or the fallback", async () => {
    const { report } = await scan(BARE, true);
    expect(report.roadmap.map((r) => r.dimension)).not.toContain("D9");
    // Real judgment about a measured dimension still stands.
    expect(report.roadmap.map((r) => r.dimension)).toContain("D1");

    const s = snap(BARE);
    const built = await buildScanScoreInput({ snapshot: s, prStats: null, governance: null, securityPosture: null, securityExposure: null, now: NOW, platformSignalsUnobservable: true });
    const fallback = assembleReport(s, built.signals, { ...model, roadmap: [] }, { name: "mock", model: "m" }, NOW, built.archetype, null, built.platformSignals);
    expect(fallback.roadmap.map((r) => r.dimension)).not.toContain("D9");
  });

  it("records the fact on the persisted record, so openBatch and the green verdict read it too", async () => {
    const { built } = await scan(BARE, true);
    expect(built.platformSignals?.securityUnobservable).toBe(true);
    expect(dimensionObservability(built.platformSignals, "D9")).toBe("unobservable");
    expect(unmeasurablePlatformDims(built.platformSignals)).toContain("D9");
  });

  it("keeps the on-disk absences visible as UNVERIFIED, never as a scored gap", async () => {
    const { built, report } = await scan(BARE, true);
    const gaps = built.scoreInput.securityAssessment!.gaps;
    expect(gaps.length).toBe(2); // dependency updates + security policy: both visible in a tree
    expect(gaps.every((g) => g.startsWith("Unverified:"))).toBe(true);
    // Surfaced in the D9 warning, where nothing can turn it into work.
    expect(report.warnings?.find((w) => w.includes("NOT MEASURED"))).toContain("Unverified: Add a SECURITY.md");
  });

  it("tells the model there is no D9 number to narrate", async () => {
    const { built } = await scan(BARE, true);
    const user = buildAssessmentPrompt(built.scoreInput).user;
    expect(user).toContain("Security (D9) = NOT MEASURED");
    expect(user).not.toContain("Security (D9) = 0/100");
  });
});

describe("D9 stays measured wherever something was measurable", () => {
  it("blind + a committed workflow: measured exactly as before", async () => {
    const { built, report } = await scan([...BARE, WORKFLOW], true);
    expect(built.scoreInput.securityAssessment?.unmeasured).toBeUndefined();
    expect(built.platformSignals?.securityUnobservable).toBeUndefined();
    expect(report.dimensions.map((d) => d.id)).toContain("D9");
    expect(report.scoreIntegrity!.unmeasuredDims).toEqual(["D2", "D3", "D4"]);
  });

  it("blind + only a committed SECURITY.md: still unmeasured, never a one-file D9 100", async () => {
    const { report } = await scan([...BARE, { path: "SECURITY.md", content: "Report to sec@acme" }], true);
    expect(report.dimensions.map((d) => d.id)).not.toContain("D9");
    expect(report.scoreIntegrity!.unmeasuredDims).toContain("D9");
  });

  it("a token-shaped scan of the same empty repo keeps today's measured 0", async () => {
    const { built, report } = await scan(BARE, false);
    expect(built.scoreInput.securityAssessment?.unmeasured).toBeUndefined();
    expect(report.dimensions.find((d) => d.id === "D9")?.score).toBe(0);
    expect(report.scoreIntegrity!.unmeasuredDims).toBeUndefined();
    expect(report.roadmap.map((r) => r.dimension)).toContain("D9");
  });
});
