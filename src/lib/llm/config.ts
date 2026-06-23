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

/**
 * Per-call LLM request timeout (ms), the single source the real providers (gemini/bedrock/openai)
 * read. Read at CALL time via envNumber so a test can stub LLM_TIMEOUT_MS without module-load
 * ordering games, and so it obeys the same parsing rules as every other knob — `envNumber` treats
 * blank as the fallback and guards Number.isFinite (unlike the old `Number(env) || 60_000`, which
 * coerced a deliberately-configured 0 back to the default). Default 60s.
 */
export function llmTimeoutMs(): number {
  return envNumber("LLM_TIMEOUT_MS", 60_000);
}

/**
 * Compose a per-call LLM cancellation signal: a timeout AbortController that fires after `ms` with
 * `new Error(message)` as the reason, combined with the caller's `signal` (a client disconnect) via
 * AbortSignal.any so whichever fires first cancels the request. Returns the combined `signal` to pass
 * to the SDK/fetch and a `clear()` to call in `finally` so the timer never leaks. Used by all three
 * real providers (gemini/bedrock/openai) so the fiddly cancellation wiring lives in one place — the
 * bug-prone parts (clearing the timer, not leaking a listener) are then correct everywhere at once.
 */
export function withLlmTimeout(
  signal: AbortSignal | undefined,
  ms: number,
  message: string,
): { signal: AbortSignal; clear: () => void } {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(new Error(message)), ms);
  const combined = signal ? AbortSignal.any([signal, timeoutCtrl.signal]) : timeoutCtrl.signal;
  return { signal: combined, clear: () => clearTimeout(timer) };
}

/**
 * Tech-stack prompt enrichment (Feature 3a, Option B) — OFF by default. When TECH_STACK_PROMPT=1|true,
 * the detected stack is added as a short block to the assessment user message. Gated because adding to
 * the prompt can move calibrated scores; roll out only after the bench shows median drift < 2 points
 * (docs/CALIBRATION.md). Unset = zero prompt change = calibration untouched (the display-only path).
 */
export function techStackPromptEnabled(): boolean {
  const v = (process.env.TECH_STACK_PROMPT ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
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

// ---------------------------------------------------------------------------
// Cache-aware cost basis + extended-thinking knob (Tiger P1-6 / P2-6c)
// ---------------------------------------------------------------------------

const CACHE_READ_RATE = 0.1; // prompt-cache READS bill at ~10% of the model's input rate
const CACHE_WRITE_RATE = 1.25; // prompt-cache WRITES bill at ~125% of the input rate

/**
 * Cache-aware input-token cost basis. Prompt caching (P0-1) splits input into three billed classes:
 * fresh input (full rate), cache writes (~125%), and cache reads (~10%). Providers report `inputTokens`
 * as the FRESH portion only, so pricing that alone under-counts a cached scan. The persisted Scan row
 * has a single `inputTokens` column (no migration), so we fold the cache classes into a COST-EQUIVALENT
 * input-token count: pricing THIS at inPerMTok reproduces the real input bill. Returns `inputTokens`
 * unchanged when no cache fields are present (the common, non-Bedrock case). [Tiger P1-6]
 */
export function billableInputTokens(usage: {
  inputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): number {
  const input = usage.inputTokens ?? 0;
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  return Math.round(input + read * CACHE_READ_RATE + write * CACHE_WRITE_RATE);
}

/**
 * Extended-thinking budget in tokens for providers that support it (Bedrock Claude today). 0 / unset =
 * thinking OFF, the default (no behavior change). Set `LLM_THINKING_BUDGET` to enable: it helps the one
 * reasoning-heavy sub-task of the assessment — the discrepancy audit — on complex repos, at higher cost
 * and latency. The Tiger benchmark predicts it's wasted on scoring/summarizing, so leave it off unless
 * you specifically want sharper discrepancy-catching. [Tiger P2-6c]
 */
export function thinkingBudgetTokens(): number {
  const n = envNumber("LLM_THINKING_BUDGET", 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

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
