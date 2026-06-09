// Keyless, deterministic provider. Lets the entire app run and demo with no API key
// (and keeps CI/build green). It derives a credible assessment directly from the
// deterministic signals, so the report is real — just without LLM-written nuance.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { DimensionSignals, LlmAssessment, LlmDimensionScore } from "@/lib/types";
import { DIMENSION_BY_ID, levelForScore, overallScoreFor } from "@/lib/maturity/model";
import { buildFallbackRoadmap } from "@/lib/scoring/recommendations";

// Memoize the deterministic assessment. assess() is a pure function of the inputs that drive it,
// so a degrade-to-mock fallback, a keyless re-scan, or a re-render of the same commit can reuse
// the prior result instead of re-deriving every dimension summary, ranking, and fallback roadmap.
// The key fingerprints the actual drivers — repo identity, head sha, archetype, and the per-signal
// scores — NOT headSha alone: a tokened scan folds in PR/governance signals, so the same commit
// can legitimately produce different signal scores and must not collide. Bounded LRU, mirroring
// the scan cache in src/lib/cache.ts. The cached assessment is treated as immutable (callers read
// it and copy fields into a fresh report), so returning a shared reference is safe.
const ASSESS_CACHE_MAX = 50;
const assessCache = new Map<string, LlmAssessment>();

function assessKey(input: LlmScoreInput): string {
  const sig = input.signals.map((s) => `${s.id}:${s.signalScore}`).join(",");
  const head = input.repo.headSha ?? "nohead";
  return `${input.repo.owner}/${input.repo.name}@${head}|${input.archetype}|${sig}`;
}

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

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    // Honor the cancellation contract uniformly across providers (provider.ts AssessOptions): the mock
    // is the degrade path most likely to run AFTER a client disconnect, so bail at entry if aborted
    // rather than compose + persist a report nobody will receive.
    opts.signal?.throwIfAborted();
    const cacheKey = assessKey(input);
    const cached = assessCache.get(cacheKey);
    if (cached) {
      // Refresh LRU recency so the hot commit survives eviction.
      assessCache.delete(cacheKey);
      assessCache.set(cacheKey, cached);
      return cached;
    }
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

    const result: LlmAssessment = {
      dimensions,
      headline: `${input.repo.owner}/${input.repo.name} sits at ${level.id} — ${level.name}: ${level.tagline}.`,
      strengths: strengths.length ? strengths : ["Repository is being analyzed against the AI-native rubric."],
      risks: risks.length ? risks : ["No major gaps detected in the sampled signals."],
      roadmap: buildFallbackRoadmap(input.signals, overall, input.archetype),
      discrepancies: [],
    };

    // Evict the LRU entry before inserting so the map stays bounded.
    if (assessCache.size >= ASSESS_CACHE_MAX) {
      const oldest = assessCache.keys().next().value;
      if (oldest) assessCache.delete(oldest);
    }
    assessCache.set(cacheKey, result);
    return result;
  }
}
