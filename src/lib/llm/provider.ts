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
  TechStack,
  TokenUsage,
} from "@/lib/types";
import { DIMENSIONS, clamp } from "@/lib/maturity/model";
import { IMPACT_LEVELS } from "@/lib/llm/schema";
import type { StackFit } from "@/lib/analyze/stack-fit";

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
  /** Stack-fit caveat (ML/notebook · mobile · embedded) when the repo's stack is one the web/service-
   *  tuned rubric under-reads. Threaded into the prompt so the model calibrates the affected dimensions
   *  and the roadmap/discrepancy audit to the stack instead of penalizing absent web conventions. Null
   *  for a full-fit (web/service) repo — the common case. */
  stackFit?: StackFit | null;
  /** Detected tech stack (Feature 3a, Option B) — present ONLY when the gated prompt-enrichment flag is
   *  on (TECH_STACK_PROMPT). Adds a short "DETECTED TECH STACK" block to the user message so the model
   *  can flag stack-vs-evidence mismatches (e.g. "claims a Python backend, zero tests"). Undefined by
   *  default → zero prompt change → calibration untouched. Gated rollout: bench < 2pt drift first. */
  techStack?: TechStack | null;
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
const IMPACTS: Set<string> = new Set(IMPACT_LEVELS);

// Cap each model-supplied string. validateAssessment bounds array COUNT but not string LENGTH, so a
// model emitting a multi-megabyte summary/headline/rationale (verbose, hallucinated repetition, or a
// prompt-injected payload) yields a "valid" assessment that bloats the persisted DB row, the SSE
// payload, and UI rendering. Bound field size like field count.
const MAX_FIELD_LEN = 2000;
const cap = (s: string): string => (s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) : s);

function asStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  // Pre-slice the INPUT before filter/map: the trailing .slice can't prevent the transient allocation
  // of mapping a hostile million-element array. A generous headroom over `max` tolerates entries that
  // get filtered out as empty/non-string. (Array.slice on a huge array is O(headroom), not O(n).)
  return v
    .slice(0, max * 4)
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => cap(x.trim()))
    .slice(0, max);
}

function asLevel(v: unknown, fallback: "high" | "medium" | "low"): "high" | "medium" | "low" {
  return typeof v === "string" && IMPACTS.has(v) ? (v as "high" | "medium" | "low") : fallback;
}

// Canonical "Lx->Ly" maturity-unlock shape (level ids are L1..L5). The deterministic roadmap derives
// this from canonical LEVELS, but the LLM path took r.levelUnlock verbatim — so a hallucinated
// "L5->L7" (out of range), "L3->L2"/"L3→L2" (a downgrade), or garbage reached the user-facing roadmap
// unchecked. Accept either arrow form, require an ACTUAL advance, and normalize to the canonical form.
const LEVEL_UNLOCK_RE = /^L([1-5])\s*(?:->|→)\s*L([1-5])$/;
function validLevelUnlock(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = LEVEL_UNLOCK_RE.exec(v.trim());
  if (!m) return undefined;
  return Number(m[2]) > Number(m[1]) ? `L${m[1]}->L${m[2]}` : undefined;
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
  const seenDimIds = new Set<string>();
  if (Array.isArray(obj.dimensions)) {
    // Bound the INPUT and de-dupe by id. roadmap/discrepancies are trailing-sliced, but `dimensions`
    // was not — a hostile/verbose reply can send a huge array of valid-id duplicates (all passing
    // VALID_DIM_IDS) that survive validation and bloat the persisted row, SSE payload, and UI. There
    // are only DIMENSIONS.length valid ids; slicing the input (cheap on a large array) bounds the work
    // and de-duping keeps the first score per dimension.
    for (const d of (obj.dimensions as Record<string, unknown>[]).slice(0, DIMENSIONS.length * 4)) {
      const id = d?.id;
      if (typeof id !== "string" || !VALID_DIM_IDS.has(id as DimensionId)) continue;
      if (seenDimIds.has(id)) continue; // first score per dimension wins
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
      seenDimIds.add(id);
      dims.push({
        id: id as DimensionId,
        score: clamp(Math.round(rawScore)),
        summary: typeof d.summary === "string" ? cap(d.summary.trim()) : "",
        strengths: asStringArray(d.strengths),
        gaps: asStringArray(d.gaps),
      });
    }
  }

  const roadmap: LlmRoadmapItem[] = [];
  if (Array.isArray(obj.roadmap)) {
    for (const r of obj.roadmap as Record<string, unknown>[]) {
      const title = typeof r?.title === "string" ? cap(r.title.trim()) : "";
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
        rationale: typeof r.rationale === "string" ? cap(r.rationale.trim()) : "",
        explore: asStringArray(r.explore, 3),
        levelUnlock: validLevelUnlock(r.levelUnlock),
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
      const claim = typeof d?.claim === "string" ? cap(d.claim.trim()) : "";
      if (dim && claim) discrepancies.push({ dimension: dim, claim });
    }
  }

  return {
    dimensions: dims,
    headline: typeof obj.headline === "string" ? cap(obj.headline.trim()) : "",
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
