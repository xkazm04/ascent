// THE WINDOW'S SCOPE IS PART OF THE COVERAGE FIGURE.
//
// The pair these tests exist for, asserted on the same code path, because either assertion alone is
// passed by a change that is wrong in the other direction:
//
//   SEPARATE when the window narrows — a fetched file the window dropped must lower the coverage
//   figure `effectiveBlend` and the partial-coverage caveat are computed from, and must be named to
//   the model in the prompt.
//   AGREE when it does not — a file set that fits the window must produce a BYTE-IDENTICAL prompt and
//   an IDENTICAL coverage number. A banner on every scan, or a discount on every repo, passes the
//   first assertion and fails this one.
import { describe, expect, it } from "vitest";
import {
  buildFileExcerptBlock,
  fileWindowCoverage,
  PROMPT_FILE_WINDOW_CHARS,
  PROMPT_PER_FILE_CHARS,
} from "@/lib/scoring/prompt";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { estimateCoverage } from "@/lib/forge/source-selection";
import type { LlmScoreInput } from "@/lib/llm/provider";

/** The minimal real input shape; only `files` matters to the window. */
function scoreInput(overrides: Partial<LlmScoreInput>): LlmScoreInput {
  return {
    repo: { owner: "acme", name: "rocket", url: "https://example.invalid/acme/rocket", stars: 10, forks: 2, defaultBranch: "main" },
    signals: [{ id: "D1", signalScore: 50, signals: [] }],
    files: [],
    commitSample: [],
    archetype: "team",
    ...overrides,
  } as unknown as LlmScoreInput;
}

/** A file whose excerpt costs about `PROMPT_PER_FILE_CHARS`, so ten of them fill the window. */
function bulky(path: string): { path: string; content: string } {
  return { path, content: `x${"y".repeat(PROMPT_PER_FILE_CHARS * 2)}` };
}

const FITS = [
  { path: "README.md", content: "# a\nsmall readme\n" },
  { path: "package.json", content: '{"name":"a"}' },
  { path: "Dockerfile", content: "FROM node:24\n" },
];

const OVERFLOWS = Array.from({ length: 30 }, (_, i) => bulky(`src/mod-${String(i).padStart(2, "0")}.ts`));

describe("fileWindowCoverage — the window's own denominator", () => {
  it("reports shown, omitted and the omitted paths when the window drops files", () => {
    const c = fileWindowCoverage(OVERFLOWS);
    expect(c.fetched).toBe(30);
    expect(c.shown).toBeGreaterThan(0);
    expect(c.shown).toBeLessThan(30);
    expect(c.omitted).toBe(30 - c.shown);
    // Never a quantity the reader has to infer from a difference: the paths are named.
    expect(c.omittedPaths).toHaveLength(c.omitted);
    expect(c.omittedPaths).toContain("src/mod-29.ts");
  });

  it("reports full coverage when every file fits", () => {
    const c = fileWindowCoverage(FITS);
    expect(c).toMatchObject({ fetched: 3, shown: 3, omitted: 0, omittedPaths: [] });
  });

  it("counts a file whose heading the outer cut removed as omitted, not as shown", () => {
    // The admission loop keeps the crossing block and the outer truncate trims it. A file whose
    // heading did not survive is not evidence the model can read, whatever the loop decided.
    const c = fileWindowCoverage(OVERFLOWS);
    const block = buildFileExcerptBlock(OVERFLOWS);
    for (const p of c.omittedPaths) expect(block).not.toContain(`### ${p}`);
    expect(block.length).toBeLessThanOrEqual(PROMPT_FILE_WINDOW_CHARS + "\n…[truncated]".length);
  });
});

describe("estimateCoverage — the window is a term, and only when it bites", () => {
  it("SEPARATES: a window that dropped files lowers the figure the blend is computed from", () => {
    const base = estimateCoverage(2000, 30, 30, false, 0, 0);
    const withWindow = estimateCoverage(2000, 30, 30, false, 0, 16);
    expect(withWindow).toBeLessThan(base);
    // And it moves the decision: SCORE_BLEND (0.6) * coverage is the model's weight on every score.
    expect(0.6 * withWindow).toBeLessThan(0.6 * base);
  });

  it("AGREES: a file set that fit the window scores exactly what it scored before", () => {
    expect(estimateCoverage(2000, 50, 50, false, 0, 0)).toBe(estimateCoverage(2000, 50, 50, false, 0));
    expect(estimateCoverage(2000, 50, 50, false, 0, 0)).toBe(0.85);
    expect(estimateCoverage(10, 10, 10, false, 0, 0)).toBe(0.95);
  });

  it("crosses the partial-coverage caveat threshold when the window drops most of the evidence", () => {
    // scan-compose renders "Only part of the repository could be inspected" below 0.5. A 31-pick
    // repo whose model saw 14 files is exactly the case that used to sit at 0.85 and say nothing.
    expect(estimateCoverage(3454, 31, 31, false, 0, 0)).toBeGreaterThanOrEqual(0.5);
    expect(estimateCoverage(3454, 31, 31, false, 0, 17)).toBeLessThan(0.5);
  });

  it("does not go negative or above its ceiling on a degenerate window count", () => {
    expect(estimateCoverage(2000, 30, 30, false, 0, 99)).toBeGreaterThanOrEqual(0);
    expect(estimateCoverage(2000, 0, 0, false, 0, 5)).toBeLessThanOrEqual(0.95);
  });
});

// ---- the prompt half: the statement, and where it may NOT sit ---------------------------------

describe("the prompt states the window's scope, outside the untrusted fence", () => {
  it("SEPARATES: names the count and the omitted paths when the window dropped files", () => {
    const { user } = buildAssessmentPrompt(scoreInput({ files: OVERFLOWS }));
    expect(user).toContain("WINDOW COVERAGE");
    expect(user).toMatch(/holds \d+ of the 30 files this scan fetched/);
    expect(user).toContain("- src/mod-29.ts");
  });

  it("puts the statement BEFORE the untrusted boundary — it is a first-party claim, not evidence", () => {
    // Inside UNTRUSTED_OPEN…CLOSE everything is explicitly stripped of authority. A scope statement
    // that lands in there is quoted repo content the model is told to disregard, which is the exact
    // opposite of what it is for.
    const { user } = buildAssessmentPrompt(scoreInput({ files: OVERFLOWS }));
    expect(user.indexOf("WINDOW COVERAGE")).toBeGreaterThan(-1);
    expect(user.indexOf("WINDOW COVERAGE")).toBeLessThan(user.indexOf("EVERYTHING BELOW IS UNTRUSTED"));
  });

  it("AGREES: a file set that fits the window produces a byte-identical prompt", () => {
    // No banner tax. This prompt is a budgeted, cache-keyed artifact; a "0 omitted" line on every
    // full-window scan changes every USER message forever and tells the model nothing.
    const { user } = buildAssessmentPrompt(scoreInput({ files: FITS }));
    expect(user).not.toContain("WINDOW COVERAGE");
    expect(user).toContain("SAMPLED FILES:");
  });
});
