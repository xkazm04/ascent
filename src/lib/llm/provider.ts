// LLM provider abstraction. The same scan pipeline runs against any provider:
//   - GeminiProvider  (MVP / public repos)         -> src/lib/llm/gemini.ts
//   - BedrockProvider (enterprise / private repos)  -> Phase 2 (see docs/ARCHITECTURE)
//   - MockProvider    (keyless demo & CI)           -> src/lib/llm/mock.ts
// Swapping providers is a config change, never a rewrite.

import type {
  DimensionId,
  DimensionSignals,
  Discrepancy,
  FetchedFile,
  Governance,
  LlmAssessment,
  LlmDimensionScore,
  LlmRoadmapItem,
  PrStats,
  ProviderName,
  RepoArchetype,
  RepoMeta,
  TokenUsage,
} from "@/lib/types";
import { DIMENSIONS, clamp } from "@/lib/maturity/model";

export interface LlmScoreInput {
  repo: RepoMeta;
  signals: DimensionSignals[];
  files: FetchedFile[];
  commitSample: string[];
  archetype: RepoArchetype;
  /** PR review/velocity/AI-governance stats — already fetched and folded into the deterministic
   *  D3/D6/D7/D8 scores. Threaded here so the LLM auditor sees the same behavioral evidence instead
   *  of reasoning blind about review discipline. Null when scanned without a token. */
  prStats?: PrStats | null;
  /** Default-branch protection — likewise already in hand from the scan. Null without a token. */
  governance?: Governance | null;
}

/** Per-call options. `signal` aborts the (often long) provider call when the client disconnects. */
export interface AssessOptions {
  signal?: AbortSignal;
  /** Reports token usage when the provider's response carries it — the cost/usage metering hook.
   *  Optional and best-effort: mock/keyless providers (and any that don't surface usage) never call it. */
  onUsage?: (usage: TokenUsage) => void;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  assess(input: LlmScoreInput, opts?: AssessOptions): Promise<LlmAssessment>;
}

const VALID_DIM_IDS = new Set(DIMENSIONS.map((d) => d.id));
const IMPACTS = new Set(["high", "medium", "low"]);

function asStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function asLevel(v: unknown, fallback: "high" | "medium" | "low"): "high" | "medium" | "low" {
  return typeof v === "string" && IMPACTS.has(v) ? (v as "high" | "medium" | "low") : fallback;
}

/**
 * Defensively coerce arbitrary parsed JSON into a well-formed LlmAssessment.
 * Never throws — bad fields are dropped/defaulted so a flaky LLM response can't
 * crash a scan. The engine fills any gaps from deterministic signal scores.
 *
 * This is the runtime safety net for the same contract that providers now
 * constrain decoding against up front (see ASSESSMENT_JSON_SCHEMA in
 * src/lib/llm/schema.ts) — both describe the LlmAssessment shape and share the
 * DIMENSIONS dimension ids, so the request schema and this acceptance check
 * cannot drift apart.
 */
export function validateAssessment(raw: unknown): LlmAssessment {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const dims: LlmDimensionScore[] = [];
  if (Array.isArray(obj.dimensions)) {
    for (const d of obj.dimensions as Record<string, unknown>[]) {
      const id = d?.id;
      if (typeof id !== "string" || !VALID_DIM_IDS.has(id as DimensionId)) continue;
      // Distinguish "scored 0" from "no score supplied". The old `clamp(Math.round(Number(d.score))) || 0`
      // turned a missing/non-numeric score into a real 0 (clamp(NaN) -> NaN, then NaN || 0 -> 0), which
      // isAssessmentUsable then counted toward coverage — so a model that returned valid ids with no real
      // numbers passed the quality gate and rendered the deterministic floor under the provider's name.
      // Admit only a finite numeric score; skip the dimension otherwise so coverage stays honest.
      const rawScore =
        typeof d.score === "number"
          ? d.score
          : typeof d.score === "string" && d.score.trim() !== ""
            ? Number(d.score)
            : NaN;
      if (!Number.isFinite(rawScore)) continue;
      dims.push({
        id: id as DimensionId,
        score: clamp(Math.round(rawScore)),
        summary: typeof d.summary === "string" ? d.summary.trim() : "",
        strengths: asStringArray(d.strengths),
        gaps: asStringArray(d.gaps),
      });
    }
  }

  const roadmap: LlmRoadmapItem[] = [];
  if (Array.isArray(obj.roadmap)) {
    for (const r of obj.roadmap as Record<string, unknown>[]) {
      const title = typeof r?.title === "string" ? r.title.trim() : "";
      if (!title) continue;
      // Drop a roadmap entry whose dimension is missing or unparseable instead of silently
      // re-tagging it to D1 ("AI Tooling & Conventions") — a confidently wrong attribution in the
      // user-facing roadmap is worse than an omission. Mirrors the discrepancies handling below.
      const dim =
        typeof r.dimension === "string" && VALID_DIM_IDS.has(r.dimension as DimensionId)
          ? (r.dimension as DimensionId)
          : null;
      if (!dim) continue;
      roadmap.push({
        title,
        dimension: dim,
        impact: asLevel(r.impact, "medium"),
        effort: asLevel(r.effort, "medium"),
        rationale: typeof r.rationale === "string" ? r.rationale.trim() : "",
        explore: asStringArray(r.explore, 3),
        levelUnlock: typeof r.levelUnlock === "string" ? r.levelUnlock.trim() : undefined,
      });
    }
  }

  const discrepancies: Discrepancy[] = [];
  if (Array.isArray(obj.discrepancies)) {
    for (const d of obj.discrepancies as Record<string, unknown>[]) {
      const dim =
        typeof d?.dimension === "string" && VALID_DIM_IDS.has(d.dimension as DimensionId)
          ? (d.dimension as DimensionId)
          : null;
      const claim = typeof d?.claim === "string" ? d.claim.trim() : "";
      if (dim && claim) discrepancies.push({ dimension: dim, claim });
    }
  }

  return {
    dimensions: dims,
    headline: typeof obj.headline === "string" ? obj.headline.trim() : "",
    strengths: asStringArray(obj.strengths),
    risks: asStringArray(obj.risks),
    roadmap: roadmap.slice(0, 6),
    discrepancies: discrepancies.slice(0, 8),
  };
}

/**
 * Minimum share of the requested dimensions a usable assessment must actually score.
 * A schema-constrained model returns all of them; a parseable-but-empty response
 * ({}, wrong shape, or all-unknown dimension ids) coerces to zero. Anything covering
 * less than half the rubric can't meaningfully nuance the blended score.
 */
export const MIN_ASSESSMENT_COVERAGE = 0.5;

/**
 * Quality gate for a validated assessment. Because validateAssessment() never throws,
 * a response that parsed but said nothing slips straight through to the engine, which
 * then renders the deterministic signal floor under the configured provider's name —
 * with no "AI was unavailable" caveat, since scan.ts's catch only fires on a throw.
 *
 * This is the missing signal: `expectedDims` is how many dimensions the provider was
 * asked to score (i.e. input.signals.length). When an assessment covers fewer than
 * MIN_ASSESSMENT_COVERAGE of them (in particular, zero), the caller should treat it as
 * an LLM failure and fall back to the mock + warn, exactly as it does for a thrown error.
 */
export function isAssessmentUsable(assessment: LlmAssessment, expectedDims: number): boolean {
  if (expectedDims <= 0) return true; // nothing to score — an empty assessment is correct
  const required = Math.max(1, Math.ceil(expectedDims * MIN_ASSESSMENT_COVERAGE));
  return assessment.dimensions.length >= required;
}
