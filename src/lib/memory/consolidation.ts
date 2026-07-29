// Write intelligence for Shared Org Memory (design doc §8 "Memory lifecycle → Write policy").
//
// THE PROBLEM IT SOLVES: shared memory AMPLIFIES bad writes. Not every utterance deserves to be stored,
// and a corrected fact must REPLACE the wrong one rather than sit beside it. So before a memory is
// committed we ask: is this actually new, does it duplicate something, or does it refine/contradict a
// memory we already trust? The answer drives the supersede path (§8 "versioning").
//
// TWO LAYERS, DELIBERATELY:
//   1. A deterministic token-overlap prefilter (pure, instant, always runs). It bounds the candidate set
//      so the prompt can never grow with the store, and it is the STANDALONE fallback when no LLM is
//      reachable. The MVP has no embeddings (§10.2 — "prove isolation first, no vectors yet"), so this
//      is the cheap stand-in for the doc's similarity threshold.
//   2. An LLM judgment over that shortlist (Claude Code CLI first). It reads semantics the token overlap
//      cannot: "Supabase OAuth replaced the custom flow" REFINES "we use a custom OAuth flow" while
//      sharing few tokens.
//
// This module is FRAMEWORK-AGNOSTIC AND PURE (design doc §5: "keep the core logic in a
// framework-agnostic module so the MCP server and REST API are thin adapters over the same functions").
// It imports no Next.js, no Prisma, and no LLM provider — the caller injects a `runPrompt` function.
// src/lib/memory/consolidation-engine.ts is the adapter that resolves the Claude CLI one.

import { parseJsonLoose } from "@/lib/llm/json";
import { MEMORY_UNTRUSTED_BOUNDARY, neutralize, wrapUntrusted } from "@/lib/llm/untrusted";
import type { ProviderName } from "@/lib/types";

/** The subset of a stored memory this pass reasons over (structurally satisfied by db MemoryRow). */
export interface MemoryCandidate {
  id: string;
  content: string;
  kind: string;
  confidence: number;
}

/** How a proposed memory relates to one existing memory. */
export type MemoryRelation = "duplicate" | "refines" | "contradicts" | "unrelated";

export interface DuplicateMatch {
  id: string;
  /** 0..1. From the model when available, else the deterministic token overlap. */
  similarity: number;
  relation: MemoryRelation;
  /** One line of why — shown verbatim in the UI beside the candidate. */
  reason: string;
}

/**
 * `novel` — nothing close; just save it.
 * `supersede` — this refines/contradicts an existing memory; offer to replace it (the §8 correction).
 * `duplicate` — we already know this; saving again would just add noise.
 */
export type MemoryRecommendation = "novel" | "supersede" | "duplicate";

export interface ConsolidationVerdict {
  recommendation: MemoryRecommendation;
  /** Ranked, strongest first. Always a subset of the shortlist we asked about (never invented). */
  duplicates: DuplicateMatch[];
  /** Optional tighter phrasing of the proposed memory, when the model offers one. */
  summary?: string;
  /** True when the judgment is the deterministic fallback, not a model's. The UI says so plainly. */
  llmUnavailable: boolean;
  engine: MemoryEngine;
}

/** Which engine produced a verdict: the provider that answered, or the deterministic fallback. Typed
 *  from the canonical ProviderName (a type-only import — this module still pulls in no provider code)
 *  so a newly supported provider can never be reported here under a stale, hand-maintained union. */
export type MemoryEngine = ProviderName | "heuristic";

export interface AnalyzeInput {
  content: string;
  kind: string;
  namespace?: string;
  candidates: MemoryCandidate[];
}

/** Injected by the adapter. Returns the model's raw text. Throwing is expected + handled. */
export type RunPrompt = (prompt: string, signal?: AbortSignal) => Promise<string>;

// ── Tunables ─────────────────────────────────────────────────────────────────────────────────

/** Below this overlap a candidate isn't worth a model's attention (or a human's). */
const OVERLAP_FLOOR = 0.12;
/** Hard cap on how many candidates reach the prompt — bounds cost + latency regardless of store size. */
const SHORTLIST_MAX = 6;
/** Each candidate is truncated to this many chars in the prompt, so one huge memory can't crowd it out. */
const CANDIDATE_EXCERPT = 600;
/** Heuristic thresholds, used only when no model is reachable. */
const HEURISTIC_DUPLICATE = 0.75;
const HEURISTIC_SIMILAR = 0.35;

// ── Layer 1: deterministic overlap ───────────────────────────────────────────────────────────

/** English-ish stopwords: they inflate overlap between two unrelated sentences. Small on purpose. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "to", "of", "in", "on", "at", "for", "with",
  "by", "from", "as", "it", "its", "we", "our", "you", "your", "they", "their", "he", "she",
  "do", "does", "did", "has", "have", "had", "not", "no", "so", "up", "out", "about", "into",
  "over", "after", "before", "when", "where", "which", "who", "will", "would", "can", "could",
  "should", "may", "might", "must", "there", "here", "all", "any", "some", "more", "most",
]);

/** Lowercase → strip punctuation → split → drop stopwords + 1-char noise. Exported for testing. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Overlap coefficient — |A ∩ B| / min(|A|,|B|) — NOT Jaccard. A short, sharp correction ("we moved to
 * Supabase OAuth") should score high against the long memory it corrects; Jaccard punishes that purely
 * for the length difference, which is exactly the case we most need to catch. Returns 0..1; 0 when
 * either side has no meaningful tokens.
 */
export function overlapScore(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const t of A) if (B.has(t)) hits++;
  return hits / Math.min(A.size, B.size);
}

/**
 * Rank candidates by overlap with the proposed content, drop the noise floor, and take the top N. This
 * is what bounds the LLM prompt — and, when no LLM is reachable, it IS the answer. Pure.
 */
export function shortlist(content: string, candidates: MemoryCandidate[]): DuplicateMatch[] {
  return candidates
    .map((c) => ({
      id: c.id,
      similarity: Number(overlapScore(content, c.content).toFixed(3)),
      relation: "unrelated" as MemoryRelation,
      reason: "Token overlap with an existing memory.",
    }))
    .filter((m) => m.similarity >= OVERLAP_FLOOR)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SHORTLIST_MAX);
}

/** The no-LLM verdict: advisory, honest about being heuristic, and never blocks the human. */
export function heuristicVerdict(matches: DuplicateMatch[]): ConsolidationVerdict {
  const top = matches[0]?.similarity ?? 0;
  const recommendation: MemoryRecommendation =
    top >= HEURISTIC_DUPLICATE ? "duplicate" : top >= HEURISTIC_SIMILAR ? "supersede" : "novel";
  return { recommendation, duplicates: matches, llmUnavailable: true, engine: "heuristic" };
}

// ── Layer 2: the model's judgment ────────────────────────────────────────────────────────────

/**
 * Build the write-intelligence prompt. Only the SHORTLIST reaches the model (never the whole store), and
 * each excerpt is truncated — so prompt size is bounded by SHORTLIST_MAX · CANDIDATE_EXCERPT no matter
 * how large the org's memory grows. Asks for strict JSON; parseVerdict re-validates everything anyway.
 *
 * EVERY foreign-authored fragment (the proposed content, the stored excerpts, and the caller-supplied
 * kind/namespace) goes through the shared untrusted-content boundary — @/lib/llm/untrusted, the same
 * implementation the scoring prompt uses. Memory content is written by members, harvested from scanned
 * repositories, and written by AGENTS, so it is exactly as untrusted as a repo file body; interpolating
 * it raw let a stored memory issue instructions to this pass, whose verdict names the ids that get
 * superseded. The trusted task statement and the output contract stay OUTSIDE the block.
 */
export function buildConsolidationPrompt(input: AnalyzeInput, matches: DuplicateMatch[]): string {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const candidateBlock = matches
    .map((m, i) => {
      const c = byId.get(m.id)!;
      const excerpt = neutralize(c.content.slice(0, CANDIDATE_EXCERPT));
      const clipped = c.content.length > CANDIDATE_EXCERPT ? " …[truncated]" : "";
      return `[${i + 1}] id=${c.id} kind=${neutralize(c.kind)} confidence=${c.confidence}\n${excerpt}${clipped}`;
    })
    .join("\n\n");

  const quoted = wrapUntrusted(`PROPOSED MEMORY
kind: ${neutralize(input.kind)}
namespace: ${input.namespace ? neutralize(input.namespace) : "(org-wide)"}
content:
${neutralize(input.content.slice(0, 4000))}

EXISTING MEMORIES (the only ids you may reference)
${candidateBlock || "(none)"}`);

  return `You are the write-gate for an engineering organization's shared memory store. A member is about to save a new memory. Decide whether it is genuinely new, whether it duplicates something already stored, or whether it CORRECTS/REFINES an existing memory (in which case the old one should be superseded).

Judge by MEANING, not word overlap. A short correction may share few words with the memory it replaces.

${MEMORY_UNTRUSTED_BOUNDARY}

${quoted}

Respond with ONLY a JSON object, no prose, no markdown fence:
{
  "recommendation": "novel" | "supersede" | "duplicate",
  "duplicates": [
    { "id": "<one of the ids above, verbatim>", "similarity": 0.0-1.0, "relation": "duplicate" | "refines" | "contradicts" | "unrelated", "reason": "<one short sentence>" }
  ],
  "summary": "<optional: a tighter one-sentence phrasing of the proposed memory>"
}

Rules:
- "duplicate" => the proposed memory adds nothing; list the memory it repeats.
- "supersede" => it refines or contradicts a stored memory; list that memory first.
- "novel" => nothing above meaningfully relates; "duplicates" may be [].
- Only use ids from the list above. Never invent an id.
- Order "duplicates" strongest first.`;
}

interface RawVerdict {
  recommendation?: unknown;
  duplicates?: unknown;
  summary?: unknown;
}

const RELATIONS: MemoryRelation[] = ["duplicate", "refines", "contradicts", "unrelated"];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Parse + HARDEN the model's verdict. Everything is re-validated against the shortlist we asked about:
 *
 *  - an id the model invented (or copied from another org's memory it hallucinated) is DROPPED. This is
 *    the load-bearing guard: a verdict id flows straight into the `supersedeId` of a write, so an
 *    unvalidated one would aim a correction at an arbitrary row. The db layer scopes the supersede to
 *    the org too (defense in depth), but the id must never leave here unless we put it in the prompt.
 *  - similarity is clamped to 0..1; a missing/garbage one falls back to the deterministic overlap.
 *  - an unknown relation/recommendation is coerced rather than trusted.
 *  - a `recommendation` of supersede/duplicate with NO surviving duplicate is downgraded to "novel" —
 *    the UI must never offer a "Supersede" button with nothing to supersede.
 *
 * Throws only if the text isn't JSON at all; the caller degrades to the heuristic verdict.
 */
export function parseVerdict(
  raw: string,
  matches: DuplicateMatch[],
  engine: ProviderName = "claude-cli",
): ConsolidationVerdict {
  const parsed = parseJsonLoose<RawVerdict>(raw);
  const allowed = new Map(matches.map((m) => [m.id, m]));

  const duplicates: DuplicateMatch[] = Array.isArray(parsed.duplicates)
    ? parsed.duplicates
        .map((d): DuplicateMatch | null => {
          if (!d || typeof d !== "object") return null;
          const { id, similarity, relation, reason } = d as Record<string, unknown>;
          if (typeof id !== "string" || !allowed.has(id)) return null; // hallucinated / out-of-scope id
          const fallback = allowed.get(id)!.similarity;
          const sim =
            typeof similarity === "number" && Number.isFinite(similarity)
              ? clamp01(similarity)
              : fallback;
          return {
            id,
            similarity: sim,
            relation: RELATIONS.includes(relation as MemoryRelation)
              ? (relation as MemoryRelation)
              : "unrelated",
            reason:
              typeof reason === "string" && reason.trim()
                ? reason.trim().slice(0, 300)
                : "Related to an existing memory.",
          };
        })
        .filter((d): d is DuplicateMatch => d !== null)
        .sort((a, b) => b.similarity - a.similarity)
    : [];

  let recommendation: MemoryRecommendation =
    parsed.recommendation === "supersede" || parsed.recommendation === "duplicate"
      ? parsed.recommendation
      : "novel";
  // Never surface a supersede/duplicate verdict with nothing to act on.
  if (recommendation !== "novel" && duplicates.length === 0) recommendation = "novel";

  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 500)
      : undefined;

  return { recommendation, duplicates, summary, llmUnavailable: false, engine };
}

// ── The entry point both adapters (route today, MCP tomorrow) call ───────────────────────────

/**
 * Run the write-intelligence pass. Always returns a usable verdict:
 *  - no candidates at all              → "novel", instantly, without touching the model;
 *  - no `runPrompt` (LLM unavailable)  → the deterministic heuristic verdict, flagged llmUnavailable;
 *  - model throws / returns non-JSON   → the SAME heuristic verdict (never a 500).
 *
 * A duplicate check that fails must degrade to "here are the similar-looking memories, you decide" —
 * it must never block the author from saving. That is the whole contract.
 */
export async function analyzeWrite(
  input: AnalyzeInput,
  runPrompt: RunPrompt | null,
  signal?: AbortSignal,
  /** Which provider `runPrompt` speaks to — reported verbatim in the verdict so the UI can name it.
   *  Ignored when `runPrompt` is null (the verdict is then the heuristic's, by definition). */
  engine: ProviderName = "claude-cli",
): Promise<ConsolidationVerdict> {
  const matches = shortlist(input.content, input.candidates);
  if (matches.length === 0) {
    return { recommendation: "novel", duplicates: [], llmUnavailable: !runPrompt, engine: runPrompt ? engine : "heuristic" };
  }
  if (!runPrompt) return heuristicVerdict(matches);

  try {
    const raw = await runPrompt(buildConsolidationPrompt(input, matches), signal);
    return parseVerdict(raw, matches, engine);
  } catch {
    // A model that times out, isn't installed, or answers with prose is not an error the author should
    // ever see — degrade to the deterministic shortlist and let them decide.
    return heuristicVerdict(matches);
  }
}
