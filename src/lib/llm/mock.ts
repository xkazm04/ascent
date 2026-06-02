// Keyless, deterministic provider. Lets the entire app run and demo with no API key
// (and keeps CI/build green). It derives a credible assessment directly from the
// deterministic signals, so the report is real — just without LLM-written nuance.

import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { DimensionSignals, LlmAssessment, LlmDimensionScore } from "@/lib/types";
import { DIMENSION_BY_ID, levelForScore, overallScoreFor } from "@/lib/maturity/model";
import { buildFallbackRoadmap } from "@/lib/scoring/recommendations";

function dimSummary(s: DimensionSignals): LlmDimensionScore {
  const def = DIMENSION_BY_ID[s.id];
  const positives = s.signals.filter((x) => !/^no\b/i.test(x.label));
  const strengths = positives.map((x) => x.label).slice(0, 4);
  const summary =
    positives.length > 0
      ? `${def.name}: ${positives.slice(0, 3).map((x) => x.label.toLowerCase()).join("; ")}.`
      : `${def.name}: no supporting signals detected in the sampled repository.`;
  const gaps =
    s.signalScore >= 80
      ? ["Already strong — focus on consistency and enforcement."]
      : [`Below target for an AI-native workflow. ${def.description}`];
  return { id: s.id, score: s.signalScore, summary, strengths, gaps };
}

export class MockProvider implements LLMProvider {
  readonly name = "mock" as const;
  readonly model = "deterministic-rubric";

  async assess(input: LlmScoreInput): Promise<LlmAssessment> {
    const dimensions = input.signals.map(dimSummary);
    // Use the engine's renormalized, archetype-aware roll-up (not a raw base-weight sum that
    // ignores the archetype lens and deflates on partial signals), so the mock's internal level,
    // headline, and fallback roadmap match the report the engine composes from these same scores.
    const overall = overallScoreFor(
      input.signals.map((s) => ({ id: s.id, score: s.signalScore })),
      input.archetype,
    );
    const level = levelForScore(overall);

    const ranked = [...input.signals].sort((a, b) => b.signalScore - a.signalScore);
    const strengths = ranked
      .filter((s) => s.signalScore >= 50)
      .slice(0, 4)
      .map((s) => `${DIMENSION_BY_ID[s.id].name} is a relative strength (${s.signalScore}/100).`);
    const risks = ranked
      .filter((s) => s.signalScore < 50)
      .reverse()
      .slice(0, 4)
      .map((s) => `${DIMENSION_BY_ID[s.id].name} is underdeveloped (${s.signalScore}/100).`);

    return {
      dimensions,
      headline: `${input.repo.owner}/${input.repo.name} sits at ${level.id} — ${level.name}: ${level.tagline}.`,
      strengths: strengths.length ? strengths : ["Repository is being analyzed against the AI-native rubric."],
      risks: risks.length ? risks : ["No major gaps detected in the sampled signals."],
      roadmap: buildFallbackRoadmap(input.signals, overall, input.archetype),
      discrepancies: [],
    };
  }
}
