// The rubric version is pinned to a scored fixture corpus, not to a hand-listed surface.
//
// model.test.ts hashes the rubric DECLARATION and says in its own comment that the detector point
// tables "aren't hashable here". This file is the pin that reaches them: RUBRIC_CORPUS driven through
// the real pipeline (detectors -> folds -> D9 battery -> prompt -> engine) and hashed on its full
// explanation object. Each seeded perturbation below is one class of edit that landed under r18
// without a bump, and each must turn the pin red.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seeds = vi.hoisted(() => ({ detector: false, skipFolds: false }));

// A detector edit, seeded one step after analyzeSignals: the class 303bb0258 (D6 +15/+5) belongs to.
vi.mock("@/lib/analyze", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/analyze")>();
  return {
    ...real,
    analyzeSignals: (...args: Parameters<typeof real.analyzeSignals>) => {
      const out = real.analyzeSignals(...args);
      return seeds.detector ? out.map((s) => (s.id === "D6" ? { ...s, signalScore: s.signalScore + 1 } : s)) : out;
    },
  };
});

// A fold edit: the PR and governance folds in pulls.ts skipped outright.
vi.mock("@/lib/analyze/pulls", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/analyze/pulls")>();
  return {
    ...real,
    applyPrSignals: (...args: Parameters<typeof real.applyPrSignals>) =>
      seeds.skipFolds ? args[0] : real.applyPrSignals(...args),
    applyGovernanceSignals: (...args: Parameters<typeof real.applyGovernanceSignals>) =>
      seeds.skipFolds ? args[0] : real.applyGovernanceSignals(...args),
  };
});

import { SCORING_RUBRIC_VERSION } from "./model";
import { RUBRIC_CORPUS } from "./rubric-corpus";
import { DEFAULT_STAGES, PINNED_RUBRIC_FINGERPRINT, rubricFingerprint } from "./rubric-fingerprint";

beforeEach(() => {
  vi.stubEnv("TECH_STACK_PROMPT", "");
  seeds.detector = false;
  seeds.skipFolds = false;
  // The engine narrates every warning to the server log; keep the suite's output about assertions.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rubricFingerprint - deterministic", () => {
  it("returns the same 64-hex sha256 twice in one process", async () => {
    const a = await rubricFingerprint(RUBRIC_CORPUS);
    const b = await rubricFingerprint(RUBRIC_CORPUS);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it("refuses to hash with TECH_STACK_PROMPT on (a prompt no production scan sends)", async () => {
    vi.stubEnv("TECH_STACK_PROMPT", "1");
    await expect(rubricFingerprint(RUBRIC_CORPUS)).rejects.toThrow(/TECH_STACK_PROMPT/);
  });
});

describe("PINNED_RUBRIC_FINGERPRINT - the version decision is forced into the diff", () => {
  it(`is pinned to rubric "${SCORING_RUBRIC_VERSION}"`, async () => {
    const actual = await rubricFingerprint(RUBRIC_CORPUS);
    expect(
      PINNED_RUBRIC_FINGERPRINT.version,
      `PINNED_RUBRIC_FINGERPRINT.version is "${PINNED_RUBRIC_FINGERPRINT.version}" but SCORING_RUBRIC_VERSION is ` +
        `"${SCORING_RUBRIC_VERSION}". Re-pin the fingerprint to the version that produced it, in the same diff as the bump.`,
    ).toBe(SCORING_RUBRIC_VERSION);
    expect(
      actual,
      `The scoring pipeline moved what the rubric corpus scores or what the model is shown about it ` +
        `(a detector, a fold, the D9 battery, the prompt, the claim verifier or the engine). Bump ` +
        `SCORING_RUBRIC_VERSION (currently "${SCORING_RUBRIC_VERSION}") in src/lib/maturity/model.ts with a changelog ` +
        `entry, then re-pin PINNED_RUBRIC_FINGERPRINT to { version: <the new version>, sha256: "${actual}" } in the same diff. ` +
        `Re-pin without a bump ONLY when the change was to rubric-corpus.ts itself.`,
    ).toBe(PINNED_RUBRIC_FINGERPRINT.sha256);
  });
});

describe("seeded perturbations - each class the declaration hash cannot see turns the pin red", () => {
  it("detector: +1 to D6 signalScore after analyzeSignals", async () => {
    const base = await rubricFingerprint(RUBRIC_CORPUS);
    seeds.detector = true;
    expect(await rubricFingerprint(RUBRIC_CORPUS)).not.toBe(base);
  });

  it("fold: applyPrSignals and applyGovernanceSignals skipped", async () => {
    const base = await rubricFingerprint(RUBRIC_CORPUS);
    seeds.skipFolds = true;
    expect(await rubricFingerprint(RUBRIC_CORPUS)).not.toBe(base);
  });

  it("user prompt: one character appended to buildAssessmentPrompt(...).user", async () => {
    const base = await rubricFingerprint(RUBRIC_CORPUS);
    const perturbed = await rubricFingerprint(RUBRIC_CORPUS, {
      ...DEFAULT_STAGES,
      prompt: (input) => {
        const p = DEFAULT_STAGES.prompt(input);
        return { ...p, user: `${p.user}.` };
      },
    });
    expect(perturbed).not.toBe(base);
  });

  it("assembly: +1 to the assembled report's D4 score", async () => {
    const base = await rubricFingerprint(RUBRIC_CORPUS);
    const perturbed = await rubricFingerprint(RUBRIC_CORPUS, {
      ...DEFAULT_STAGES,
      assemble: (...args) => {
        const r = DEFAULT_STAGES.assemble(...args);
        return { ...r, dimensions: r.dimensions.map((d) => (d.id === "D4" ? { ...d, score: d.score + 1 } : d)) };
      },
    });
    expect(perturbed).not.toBe(base);
  });
});

// ---- guard: the corpus and the fingerprint never ship --------------------------------------------

/** Comments stripped, strings KEPT: an import specifier is a string, and it is the thing matched. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const IMPORTS_TEST_ONLY =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'][^"']*maturity\/rubric-(?:corpus|fingerprint)["']/;
const importsTestOnly = (src: string) => IMPORTS_TEST_ONLY.test(stripComments(src));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("guard: rubricFingerprint is test-only", () => {
  it("the matcher bites on a seeded import and ignores one that is only a comment", () => {
    expect(importsTestOnly('import { RUBRIC_CORPUS } from "@/lib/maturity/rubric-corpus";')).toBe(true);
    expect(importsTestOnly("const m = await import('@/lib/maturity/rubric-fingerprint');")).toBe(true);
    expect(importsTestOnly('// import { RUBRIC_CORPUS } from "@/lib/maturity/rubric-corpus";')).toBe(false);
    expect(importsTestOnly('/* from "@/lib/maturity/rubric-fingerprint" */ export const x = 1;')).toBe(false);
  });

  it("nothing under src/app or src/components imports rubric-corpus.ts or rubric-fingerprint.ts", () => {
    const offenders = ["src/app", "src/components"]
      .flatMap((d) => sourceFiles(join(process.cwd(), d)))
      .filter((p) => importsTestOnly(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
