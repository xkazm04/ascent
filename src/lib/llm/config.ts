// Env-driven LLM tuning knobs shared by the real providers. Temperature and Bedrock's maxTokens were
// hard-coded literals, so a big-repo assessment could be truncated by the fixed cap and determinism
// couldn't be tuned without a code change — inconsistent with the existing GEMINI_MODEL /
// BEDROCK_MODEL_ID / LLM_TIMEOUT_MS env convention. These default to the prior literals, so unset
// envs preserve exact behavior.

/** Read an env var as a number, falling back to `fallback` when unset/blank/non-numeric. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Built-in per-model price table
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** Model-id prefix this rate applies to (matched after geo-prefix stripping; longest wins). */
  prefix: string;
  /** USD per million input tokens. */
  inPerMTok: number;
  /** USD per million output tokens. */
  outPerMTok: number;
}

/**
 * APPROXIMATE list prices (USD per MTok) for the models this app ships as defaults — cached from
 * the providers' public price sheets on 2026-06-12. This is the DEFAULT cost basis for the /usage
 * estimate so the panel works out-of-the-box and prices mixed-provider fleets per-model; the
 * LLM_INPUT_COST_PER_MTOK / LLM_OUTPUT_COST_PER_MTOK env rates, when BOTH are set, always win
 * (negotiated/discounted rates differ from list). Estimates only — never an invoice.
 *
 * Matching is longest-prefix over the persisted Scan.engineModel, lowercased, with Bedrock geo
 * routing prefixes (us./eu./apac./global.) stripped first — so "us.anthropic.claude-sonnet-4-6"
 * prices the same as "anthropic.claude-sonnet-4-6".
 */
export const MODEL_PRICES: ModelPrice[] = [
  // Gemini (GEMINI_MODEL): the preview default + the GA successor the header doc points at.
  { prefix: "gemini-3-flash", inPerMTok: 0.5, outPerMTok: 3 },
  { prefix: "gemini-3.5-flash", inPerMTok: 1.5, outPerMTok: 9 },
  // Claude via Bedrock (BEDROCK_MODEL_ID), geo prefix stripped. Family prefixes (…-4) cover the
  // 4.x point releases, which share a list price per tier.
  { prefix: "anthropic.claude-sonnet-4", inPerMTok: 3, outPerMTok: 15 },
  { prefix: "anthropic.claude-haiku-4", inPerMTok: 1, outPerMTok: 5 },
  { prefix: "anthropic.claude-opus-4", inPerMTok: 5, outPerMTok: 25 },
  // Claude CLI aliases (CLAUDE_MODEL: "sonnet"/"haiku"/"opus") — same models, first-party rates.
  { prefix: "sonnet", inPerMTok: 3, outPerMTok: 15 },
  { prefix: "haiku", inPerMTok: 1, outPerMTok: 5 },
  { prefix: "opus", inPerMTok: 5, outPerMTok: 25 },
  // OpenAI (OPENAI_MODEL default gpt-4o-mini; bare gpt-4o for the obvious upgrade).
  { prefix: "gpt-4o-mini", inPerMTok: 0.15, outPerMTok: 0.6 },
  { prefix: "gpt-4o", inPerMTok: 2.5, outPerMTok: 10 },
];

/** Bedrock cross-region inference geo prefixes — routing metadata, not part of the model id. */
const GEO_PREFIX = /^(us|eu|apac|global)\./;

/**
 * Longest-prefix price lookup for a persisted engine model id. Pure. Returns null for unknown
 * models (incl. "mock", which reports no tokens anyway) — the caller shows "no estimate" rather
 * than pricing unknown tokens at a made-up rate.
 */
export function priceForModel(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const id = model.trim().toLowerCase().replace(GEO_PREFIX, "");
  let best: ModelPrice | null = null;
  for (const p of MODEL_PRICES) {
    if (id.startsWith(p.prefix) && (best === null || p.prefix.length > best.prefix.length)) {
      best = p;
    }
  }
  return best;
}
