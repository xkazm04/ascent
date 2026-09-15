// D4 CONVERGENCE (rubric r13) — the composition half of the workflow-reserve repair.
//
// The campaign's finding, restated as a test: D4's oscillation was never a scoring rule. Given the
// citations the model produces when it can SEE the workflow, the engine already lands on one number
// every time; given the citations it improvises when it cannot, the engine lands on two. So this file
// pins the composition around that boundary — the restored reading, the floor a genuine gap still
// gets, and the deliberate ABSENCE of a not-applicable hatch for D4.
//
// The window half (why the model could not see the workflow) is pinned by prompt-workflow-reserve.test.ts.

import { describe, expect, it } from "vitest";

import { assembleReport } from "@/lib/scoring/engine";
import { facetPoints } from "@/lib/scoring/claims";
import { platformSignalsUnavailable } from "@/lib/analyze/platform-carry";
import type { Claim, DimensionSignals, LlmAssessment, RepoSnapshot } from "@/lib/types";

/** `kp`'s shape: a Python repo whose whole agentic story lives in workflow files. */
const DISPATCH_WF =
  "name: agent-dispatch\non:\n  issue_comment:\n    types: [created]\njobs:\n  dispatch:\n    steps:\n      - run: node scripts/agent/dispatch.mjs\n      - run: gh pr create --fill\n";
const AUTOFIX_WF =
  "name: autofix\non:\n  pull_request:\njobs:\n  fix:\n    steps:\n      - run: ruff check --fix .\n      - run: git-auto-commit\n";
const REVIEW_WF =
  "name: agent-review\non:\n  pull_request:\njobs:\n  review:\n    steps:\n      - run: node scripts/agent-review.mjs --base origin/master\n";
const RUFF = "# line-length rules; numbers and deletes dead entries, and autofix.yml runs it on\nline-length = 100\n";

function snap(files: { path: string; content: string }[], commits: string[] = []): RepoSnapshot {
  return {
    meta: { owner: "xkazm04", name: "kp", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files,
    commits: commits.map((message) => ({ message, authorLogin: "a", date: "2026-08-30T00:00:00Z" })),
    truncated: false,
    coverage: 1,
  };
}

/** The campaign's deterministic reading, verbatim: D4 signalScore 10 (dependency_automation only) on
 *  all 34 readings, because both repos' review machinery is bespoke and the regex knows vendors. */
const signals = (facets: string[] = ["dependency_automation"]): DimensionSignals[] => [
  { id: "D4", signalScore: 10, signals: [{ label: "Dependency update bot configured" }], facets },
  { id: "D1", signalScore: 60, signals: [{ label: "fixture" }] },
];

const assessment = (claims: Claim[]): LlmAssessment => ({
  dimensions: [
    { id: "D4", score: 80, summary: "s", strengths: [], gaps: [] },
    { id: "D1", score: 60, summary: "s", strengths: [], gaps: [] },
  ],
  headline: "",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
  claims,
});

const eng = { name: "gemini" as const, model: "x" };
const AT = "2026-01-01T00:00:00Z";
const d4Of = (r: ReturnType<typeof assembleReport>) => r.dimensions.find((d) => d.id === "D4")!;

/** A worktree reading: the GitHub-side folds were not observable. */
const BLIND = platformSignalsUnavailable();

const FILES = [
  { path: "ruff.toml", content: RUFF },
  { path: ".github/workflows/agent-dispatch.yml", content: DISPATCH_WF },
  { path: ".github/workflows/autofix.yml", content: AUTOFIX_WF },
  { path: ".github/workflows/agent-review.yml", content: REVIEW_WF },
];
const COMMITS = ["fix: address the agent review's finding on dispatch input handling"];

describe("a blind worktree scan of a repo that genuinely HAS agentic review", () => {
  it("is no longer at the floor once the workflows are citable", () => {
    const r = assembleReport(
      snap(FILES, COMMITS),
      signals(),
      assessment([
        { dimension: "D4", facet: "automated_review", path: ".github/workflows/agent-review.yml", quote: "run: node scripts/agent-review.mjs --base origin/master" },
        { dimension: "D4", facet: "autofix", path: ".github/workflows/autofix.yml", quote: "run: ruff check --fix ." },
        { dimension: "D4", facet: "agent_dispatch", path: ".github/workflows/agent-dispatch.yml", quote: "run: gh pr create --fill" },
        { dimension: "D4", facet: "observed", path: "commits", quote: "address the agent review's finding" },
      ]),
      eng, AT, "org", undefined, BLIND,
    );
    const expected =
      10 + facetPoints("automated_review") + facetPoints("autofix") + facetPoints("agent_dispatch") + facetPoints("observed");
    expect(d4Of(r).score).toBe(expected); // 10 + 25 + 10 + 5 + 15 = 65
    expect(d4Of(r).score).toBeGreaterThan(20); // the campaign's ceiling for this repo
  });

  it("reproduces the OLD reading from the citations a blind model actually produced", () => {
    // Campaign run-04: with no workflow in the window the model quoted a COMMENT IN ruff.toml that
    // mentions autofix.yml. It verifies (the words are in the file) and it buys 10 — the "20" arm.
    const r = assembleReport(
      snap(FILES, COMMITS),
      signals(),
      assessment([
        { dimension: "D4", facet: "autofix", path: "ruff.toml", quote: "and autofix.yml runs it on" },
        { dimension: "D4", facet: "observed", path: "commits", quote: "address the agent review's finding" },
      ]),
      eng, AT, "org", undefined, BLIND,
    );
    expect(d4Of(r).score).toBe(20);
  });

  it("shows the OTHER arm of the bistability, and why it was 10 rather than 20", () => {
    // Same repo, same commit: the model paraphrased instead of quoting, autofix dropped, and
    // `observed`'s requiresAny then dropped 15 more — one missed citation costing 25.
    const r = assembleReport(
      snap(FILES, COMMITS),
      signals(),
      assessment([
        { dimension: "D4", facet: "autofix", path: "ruff.toml", quote: "autofix.yml runs ruff on every push" },
        { dimension: "D4", facet: "observed", path: "commits", quote: "address the agent review's finding" },
      ]),
      eng, AT, "org", undefined, BLIND,
    );
    expect(d4Of(r).score).toBe(10);
    expect(d4Of(r).evidence.some((e) => /Unverified claim \(quote-not-found\) — autofix/.test(e))).toBe(true);
    expect(d4Of(r).evidence.some((e) => /Unverified claim \(unsupported-trail\) — observed/.test(e))).toBe(true);
  });
});

describe("the exclusion that deliberately did NOT happen", () => {
  it("a blind reading still SCORES D4 — it is not marked not-applicable and not renormalised out", () => {
    // D4's base is a file scan of `.github/workflows/*`, which a worktree reads as well as GitHub
    // does. Only the ADDITIVE platform fold is unobservable, and a withheld bonus is not a floor
    // presented as a measurement. Excluding a measurable dimension would inflate every local score.
    const r = assembleReport(
      snap(FILES, COMMITS),
      signals(),
      assessment([
        { dimension: "D4", facet: "automated_review", path: ".github/workflows/agent-review.yml", quote: "run: node scripts/agent-review.mjs --base origin/master" },
      ]),
      eng, AT, "org", undefined, BLIND,
    );
    expect(r.dimensions.map((d) => d.id)).toContain("D4");
    expect(r.scoreIntegrity?.unmeasuredDims).toContain("D4"); // disclosed, per the existing channel
    // …and the disclosure moves no number: the overall is the weighted mean over BOTH dimensions.
    const withoutD4 = assembleReport(
      snap(FILES, COMMITS),
      [signals()[1]],
      assessment([]),
      eng, AT, "org", undefined, BLIND,
    );
    expect(r.overallScore).not.toBe(withoutD4.overallScore);
  });

  it("a repo with a REAL D4 gap still scores it at the floor, and the overall carries it", () => {
    const bare = snap([{ path: "README.md", content: "# a repo with no automation at all\n" }]);
    const r = assembleReport(bare, signals([]), assessment([]), eng, AT, "org", undefined, BLIND);
    expect(d4Of(r).score).toBe(10);
    // Weighted mean over D1=60 and D4=10 lands strictly between them — D4 is not held out.
    expect(r.overallScore).toBeGreaterThan(10);
    expect(r.overallScore).toBeLessThan(60);
  });
});

describe("cross-dimension claim rejections are no longer rendered as D4 evidence (r13)", () => {
  const withD1Claims = () =>
    assembleReport(
      snap([...FILES, { path: "AGENTS.md", content: "Full agent guide: [.claude/CLAUDE.md](./.claude/CLAUDE.md)\n" }], COMMITS),
      signals(),
      assessment([
        { dimension: "D4", facet: "automated_review", path: ".github/workflows/agent-review.yml", quote: "run: node scripts/agent-review.mjs --base origin/master" },
        { dimension: "D1", facet: "canonical_declared", path: "AGENTS.md", quote: "Full agent guide: [.claude/CLAUDE.md]" },
      ]),
      eng, AT, "org", undefined, BLIND,
    );

  it("does not print a D1 claim on the D4 card as a verification failure", () => {
    const ev = d4Of(withD1Claims()).evidence;
    expect(ev.some((e) => /not-this-dimension/.test(e))).toBe(false);
    expect(ev.some((e) => /canonical_declared/.test(e))).toBe(false);
  });

  it("still prints every rejection that IS about this dimension", () => {
    const r = assembleReport(
      snap(FILES, COMMITS),
      signals(),
      assessment([{ dimension: "D4", facet: "automated_review", path: ".github/workflows/agent-review.yml", quote: "run: node scripts/nope.mjs --base origin/master" }]),
      eng, AT, "org", undefined, BLIND,
    );
    expect(d4Of(r).evidence.some((e) => /Unverified claim \(quote-not-found\)/.test(e))).toBe(true);
  });

  it("suppresses the line, never the score: the D1 claim is still awarded on D1", () => {
    const d1 = withD1Claims().dimensions.find((d) => d.id === "D1")!;
    expect(d1.score).toBe(60 + facetPoints("canonical_declared"));
  });
});
