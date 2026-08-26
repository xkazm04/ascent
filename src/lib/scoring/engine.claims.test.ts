// D4 under cited-claim scoring (rubric r9, scoring/claims.ts) — the engine's composition rule:
// score = detector points + points for VERIFIED claims on facets the detector did NOT find. The
// model's D4 score field never moves the number; a rejected claim is rendered, not scored.

import { describe, expect, it } from "vitest";

import { assembleReport } from "@/lib/scoring/engine";
import { facetPoints } from "@/lib/scoring/claims";
import type { DimensionSignals, LlmAssessment, RepoSnapshot } from "@/lib/types";

const REVIEW_WF = "name: review\non:\n  pull_request:\njobs:\n  review:\n    steps:\n      - run: ./scripts/review.sh\n";

function snap(files: { path: string; content: string }[] = []): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files,
    commits: [],
    truncated: false,
    coverage: 1,
  };
}

const d4 = (signalScore: number, facets: string[] = []): DimensionSignals[] => [
  { id: "D4", signalScore, signals: [{ label: "fixture" }], facets },
  // A second, ordinary dimension so the overall has something to renormalize over.
  { id: "D1", signalScore: 50, signals: [{ label: "fixture" }] },
];

const assessment = (over: Partial<LlmAssessment>): LlmAssessment => ({
  dimensions: [
    { id: "D4", score: 95, summary: "s", strengths: [], gaps: [] },
    { id: "D1", score: 50, summary: "s", strengths: [], gaps: [] },
  ],
  headline: "",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
  ...over,
});

const eng = { name: "gemini" as const, model: "x" };
const AT = "2026-01-01T00:00:00Z";
const d4Of = (r: ReturnType<typeof assembleReport>) => r.dimensions.find((d) => d.id === "D4")!;

describe("D4 is scored from verified citations, not from the model's score field", () => {
  it("ignores the model's D4 score: with no claims, the score IS the detector's", () => {
    const r = assembleReport(snap(), d4(28), assessment({}), eng, AT, "org");
    expect(d4Of(r).score).toBe(28); // the model said 95; the old blend would have moved this to ~32
    expect(d4Of(r).llmScore).toBe(95); // …but the number is still recorded for transparency
  });

  it("adds a facet's points for a VERIFIED claim the detector did not find", () => {
    const s = snap([{ path: ".github/workflows/review.yml", content: REVIEW_WF }]);
    const r = assembleReport(
      s,
      d4(10),
      assessment({
        claims: [{ dimension: "D4", facet: "automated_review", path: ".github/workflows/review.yml", quote: "run: ./scripts/review.sh" }],
      }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(10 + facetPoints("automated_review"));
    expect(d4Of(r).evidence.some((e) => /Model cited automated_review \(\+25\)/.test(e))).toBe(true);
  });

  it("adds NOTHING for a claim whose quote is not in the file, and says so in the evidence", () => {
    const s = snap([{ path: ".github/workflows/review.yml", content: REVIEW_WF }]);
    const r = assembleReport(
      s,
      d4(10),
      assessment({
        claims: [{ dimension: "D4", facet: "automated_review", path: ".github/workflows/review.yml", quote: "uses: coderabbitai/ai-pr-reviewer" }],
      }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(10);
    expect(d4Of(r).evidence.some((e) => /Unverified claim \(quote-not-found\)/.test(e))).toBe(true);
  });

  it("treats a verified claim on a facet the detector already found as confirmation, not a second award", () => {
    const s = snap([{ path: ".github/workflows/review.yml", content: REVIEW_WF }]);
    const r = assembleReport(
      s,
      d4(25, ["automated_review"]),
      assessment({
        claims: [{ dimension: "D4", facet: "automated_review", path: ".github/workflows/review.yml", quote: "run: ./scripts/review.sh" }],
      }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(25);
    expect(d4Of(r).evidence.some((e) => /Model confirmed automated_review/.test(e))).toBe(true);
  });

  it("lets a bespoke review the regex cannot name reach green through citations alone", () => {
    // The whole point: no vendor anywhere. A custom prompt, a script, a gate, a trail.
    const s = snap([
      { path: ".github/workflows/review.yml", content: REVIEW_WF + "    if: always()\n  gate:\n    needs: review\n    steps:\n      - run: test \"$(cat review.verdict)\" = pass\n" },
      { path: "prompts/review-rubric.md", content: "# Review rubric\n\nFlag any change that widens a public API without a test. Reject secrets in diffs." },
      { path: ".github/dependabot.yml", content: "version: 2\nupdates:\n  - package-ecosystem: npm\n" },
    ]);
    s.commits.push({ message: "fix: address automated review findings on auth handler" });
    const r = assembleReport(
      s,
      d4(0),
      assessment({
        claims: [
          { dimension: "D4", facet: "automated_review", path: ".github/workflows/review.yml", quote: "run: ./scripts/review.sh" },
          { dimension: "D4", facet: "custom_judgment", path: "prompts/review-rubric.md", quote: "Flag any change that widens a public API" },
          { dimension: "D4", facet: "review_teeth", path: ".github/workflows/review.yml", quote: "test \"$(cat review.verdict)\" = pass" },
          { dimension: "D4", facet: "observed", path: "commits", quote: "address automated review findings" },
          { dimension: "D4", facet: "dependency_automation", path: ".github/dependabot.yml", quote: "package-ecosystem: npm" },
        ],
      }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(25 + 20 + 15 + 15 + 10);
    expect(d4Of(r).score).toBeGreaterThanOrEqual(85);
  });

  it("does not let a config-only repo reach green: the exploit in SCORING-VALIDITY §2 tops out below the band", () => {
    // Every facet a bare config could plausibly be cited for, and nothing that runs or ran.
    const s = snap([
      { path: ".coderabbit.yaml", content: "reviews:\n  profile: chill\n" },
      { path: ".github/dependabot.yml", content: "version: 2\nupdates: []\n" },
    ]);
    const r = assembleReport(
      s,
      d4(25 + 10, ["automated_review", "dependency_automation"]),
      assessment({
        claims: [
          { dimension: "D4", facet: "automated_review", path: ".coderabbit.yaml", quote: "reviews:\n  profile: chill" },
          { dimension: "D4", facet: "dependency_automation", path: ".github/dependabot.yml", quote: "package-ecosystem" },
        ],
      }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(35);
    expect(d4Of(r).score).toBeLessThan(85);
  });
});

describe("observed needs a mechanism (the first live r9 finding)", () => {
  it("does not award a trail in a repo with nothing for it to be a trail of", () => {
    const s = snap();
    s.commits.push({ message: "fix(build): clear stale tsbuildinfo before tsc [candidate: imp-tc-001]" });
    const r = assembleReport(
      s,
      d4(0),
      assessment({ claims: [{ dimension: "D4", facet: "observed", path: "commits", quote: "clear stale tsbuildinfo before tsc" }] }),
      eng, AT, "org",
    );
    expect(d4Of(r).score).toBe(0);
    expect(d4Of(r).evidence.some((e) => /Unverified claim \(unsupported-trail\)/.test(e))).toBe(true);
  });
});
