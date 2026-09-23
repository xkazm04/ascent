// The rubric fingerprint: RUBRIC_CORPUS driven through the real scoring pipeline and hashed on its
// full explanation object, pinned to SCORING_RUBRIC_VERSION.
//
// TEST-ONLY (see rubric-corpus.ts). Nothing under src/app or src/components may import it.
//
// WHAT IT REACHES. Per fixture: buildScanScoreInput (the nine detectors, the PR / governance /
// platform folds, the D9 check battery) -> buildAssessmentPrompt (system AND user message, so the
// file window, the WINDOW COVERAGE block and every signal label the model reads) -> assembleReport
// (claim verification, the discrepancy budget, the D9 hatch, the coverage-weighted blend, lenses,
// levels, the fallback and follow-up roadmap). The coverage figure of the window fixture is computed
// by the ingest path's own estimateCoverage.
//
// WHAT IT CANNOT REACH, stated so nobody mistakes the pin for more than it is: a live model's answer
// (each fixture carries a canned one), and the network half of ingestion (which files a forge returns
// for a tree, e.g. the truncated-tree probe). A change there still needs the bump decision by hand.
//
// DETERMINISM. One clock (RUBRIC_NOW), no network (no decisionSlug, so the decision/craft store is
// never read), and TECH_STACK_PROMPT must be OFF (the production default) - the fingerprint refuses to
// run otherwise rather than hash a prompt no production scan sends.

import { createHash } from "node:crypto";
import { buildScanScoreInput, type ScoreInputPhaseResult } from "@/lib/scan-score-input";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { assembleReport } from "@/lib/scoring/engine";
import { techStackPromptEnabled } from "@/lib/llm/config";
import { formatSignal, type ScanReport } from "@/lib/types";
import { RUBRIC_NOW, type RubricFixture } from "./rubric-corpus";

/**
 * The pin. `version` is a LITERAL, not a reference to SCORING_RUBRIC_VERSION, so the two can disagree
 * and the test can say so. When rubric-fingerprint.test.ts goes red on `sha256`, a change moved what
 * the corpus scores or what the model is shown: bump SCORING_RUBRIC_VERSION (with its changelog
 * entry) and re-pin BOTH fields here in the same diff. Re-pinning `sha256` alone is correct only when
 * the corpus itself changed (a fixture added or edited), never when the pipeline did.
 */
export const PINNED_RUBRIC_FINGERPRINT = {
  version: "r19",
  sha256: "80e2cff0694f9fdba9821c54320e08982a0bf1fd5c1736110ea2732857f52bc4",
} as const;

/** The pipeline stages, injectable so a test can seed a violation and watch the pin see it. */
export interface FingerprintStages {
  scoreInput: typeof buildScanScoreInput;
  prompt: typeof buildAssessmentPrompt;
  assemble: typeof assembleReport;
}

export const DEFAULT_STAGES: FingerprintStages = {
  scoreInput: buildScanScoreInput,
  prompt: buildAssessmentPrompt,
  assemble: assembleReport,
};

/** Everything one fixture produced, before canonicalisation (the coverage test reads it raw). */
export interface FixtureTrace {
  fixture: RubricFixture;
  phase: ScoreInputPhaseResult;
  system: string;
  user: string;
  report: ScanReport;
}

/** Stamped on report.engine only, which the fingerprint does not read: the answer is canned. */
const ENGINE = { name: "mock", model: "rubric-fixture" } as const;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Run every fixture through the pipeline, in corpus order. */
export async function traceCorpus(
  corpus: readonly RubricFixture[],
  stages: FingerprintStages = DEFAULT_STAGES,
): Promise<FixtureTrace[]> {
  if (techStackPromptEnabled())
    throw new Error("rubricFingerprint: TECH_STACK_PROMPT must be off (the production default) - stub it in the test.");
  const traces: FixtureTrace[] = [];
  for (const fixture of corpus) {
    const phase = await stages.scoreInput({
      snapshot: fixture.snapshot,
      prStats: fixture.prStats,
      governance: fixture.governance,
      securityPosture: fixture.securityPosture,
      securityExposure: fixture.securityExposure,
      appInventory: fixture.appInventory ?? null,
      ciHealth: fixture.ciHealth ?? null,
      now: RUBRIC_NOW,
    });
    const { system, user } = stages.prompt(phase.scoreInput);
    const report = stages.assemble(
      fixture.snapshot,
      phase.signals,
      fixture.assessment,
      ENGINE,
      RUBRIC_NOW,
      phase.archetype,
      fixture.prStats,
      phase.platformSignals ?? null,
    );
    traces.push({ fixture, phase, system, user, report });
  }
  return traces;
}

/** The explanation object one fixture is pinned on. Field order is fixed by construction. */
export function canonicalFixture(t: FixtureTrace): unknown {
  const r = t.report;
  return {
    id: t.fixture.id,
    archetype: t.phase.archetype,
    signals: t.phase.signals.map((s) => ({
      id: s.id,
      signalScore: s.signalScore,
      deterministic: s.deterministic ?? false,
      facets: s.facets ?? [],
      labels: s.signals.map(formatSignal),
    })),
    platformFold: t.phase.platformSignals?.dims ?? null,
    systemSha: sha(t.system),
    userSha: sha(t.user),
    report: {
      overallScore: r.overallScore,
      level: r.level.id,
      adoptionScore: r.adoptionScore,
      rigorScore: r.rigorScore,
      confidence: r.confidence,
      dimensions: r.dimensions.map((d) => ({
        id: d.id,
        weight: d.weight,
        score: d.score,
        signalScore: d.signalScore,
        llmScore: d.llmScore,
        evidence: d.evidence,
      })),
      roadmap: r.roadmap.map((i) => `${i.dimension}:${i.kind ?? "gap"}`),
      scoreIntegrity: r.scoreIntegrity ?? null,
      incomplete: r.incomplete ?? false,
    },
  };
}

/** One sha256 over the whole corpus's explanation objects. */
export async function rubricFingerprint(
  corpus: readonly RubricFixture[],
  stages: FingerprintStages = DEFAULT_STAGES,
): Promise<string> {
  const traces = await traceCorpus(corpus, stages);
  return sha(JSON.stringify(traces.map(canonicalFixture)));
}
