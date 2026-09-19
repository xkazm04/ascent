// The evidence pack's headline reading, as a chain rather than a paragraph (org UX redesign §2).
//
// The card's 207-character standfirst named three things in a row — "the population of AI-attributed
// changes in the period, a reproducible sample drawn from it, and per-item evidence of whether a
// human approving review happened before merge". Three clauses describing a funnel. They are now the
// three stages of a `FlowRibbon`, and where the population cannot be read every stage is a VOID: the
// kit refuses to draw a stage of height zero for a measurement nobody made.
//
// The draw uses the SAME seed and the SAME algorithm the export route does, so the sample this
// picture counts is the sample the CSV would contain — a headline that disagreed with the artifact
// would be worse than no headline.
//
// PURE — no I/O. Server-only by dependency (the verdict comes from the pack module).

import { DEFAULT_SAMPLE_SIZE, drawSample, sampleSeed } from "@/lib/conformance/sample";
import { verdictFor } from "@/lib/conformance/pack";
import type { AiChangePopulation } from "@/lib/db/ai-changes";
import type { FlowStage } from "@/components/org/viz";

/** The period bounds as the pack states them — "all-time" for an open end, never a fabricated date. */
export function periodBound(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "all-time";
}

export interface EvidenceFlow {
  stages: FlowStage[];
  /** True when nothing could be read — the card then says so instead of implying an empty period. */
  unmeasured: boolean;
  /** Sampled items that never merged, so the pre-merge control was never due to operate on them. */
  notApplicable: number;
}

/**
 * Population → sampled → reviewed.
 *
 * Each stage is a subset of the one before it, which is what makes a ribbon the honest shape here.
 * "Reviewed" counts sampled items whose control OPERATED — a merged change with an approving human
 * review recorded before it merged. Items that never merged are counted separately rather than
 * folded into the shortfall: they are not findings, and a ribbon that implied they were would be the
 * same over-claim the card's own limitations section exists to prevent.
 */
export function evidenceFlow(
  pop: AiChangePopulation | null,
  org: string,
  from: string,
  to: string,
): EvidenceFlow {
  if (!pop) {
    return {
      unmeasured: true,
      notApplicable: 0,
      stages: [
        { id: "population", label: "Population", value: null },
        { id: "sampled", label: "Sampled", value: null },
        { id: "reviewed", label: "Reviewed", value: null },
      ],
    };
  }

  const drawn = drawSample(pop.changes, DEFAULT_SAMPLE_SIZE, sampleSeed(org, from, to));
  const verdicts = drawn.map(verdictFor);

  return {
    unmeasured: false,
    notApplicable: verdicts.filter((v) => v === "not-applicable").length,
    stages: [
      { id: "population", label: "Population", value: pop.changes.length, state: "measured" },
      { id: "sampled", label: "Sampled", value: drawn.length, state: "measured" },
      { id: "reviewed", label: "Reviewed", value: verdicts.filter((v) => v === "operated").length, state: "measured" },
    ],
  };
}
