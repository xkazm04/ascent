import type { ProviderName } from "@/lib/types";

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
 * Floor for the per-call LLM timeout (ms). `LLM_TIMEOUT_MS=0` reads intuitively as "no timeout /
 * disabled", but `envNumber` accepts 0 (and negatives) as finite, so it flowed straight into
 * `setTimeout(abort, 0)` — the AbortController then fired on the very next tick, cancelling EVERY
 * gemini/bedrock/openai/openrouter call before it could answer and silently routing 100% of scans to
 * the deterministic mock floor (disclosed only by the generic "Model unavailable" caveat — very hard
 * to diagnose). A 0/negative/tiny timeout is a misconfiguration, not "no timeout": there is
 * deliberately NO unbounded option (an untimed call would eat scan.ts's whole 90s budget and starve
 * the retry + failover steps). So clamp to a floor large enough that a real request can actually
 * complete. 1s is well below any healthy provider round-trip yet still bounds a hung call.
 */
const MIN_LLM_TIMEOUT_MS = 1_000;

/**
 * Per-call LLM request timeout (ms), the single source the real providers (gemini/bedrock/openai)
 * read. Read at CALL time via envNumber so a test can stub LLM_TIMEOUT_MS without module-load
 * ordering games, and so it obeys the same parsing rules as every other knob — `envNumber` treats
 * blank as the fallback and guards Number.isFinite (unlike the old `Number(env) || 60_000`, which
 * coerced a deliberately-configured 0 back to the default). The result is floored to
 * MIN_LLM_TIMEOUT_MS so a 0/negative/tiny value can't instant-abort every scan to mock. Default 60s.
 */
export function llmTimeoutMs(): number {
  return Math.max(MIN_LLM_TIMEOUT_MS, envNumber("LLM_TIMEOUT_MS", 60_000));
}

/**
 * Per-call sampling temperature (the determinism knob) — the single source ALL the real providers
 * (gemini/openai/bedrock/openrouter) read, mirroring llmTimeoutMs so the env name and the `0.2`
 * default live in one place instead of being re-inlined per provider. Read at CALL time via envNumber
 * (same parsing: blank → fallback, Number.isFinite-guarded). Default **0**.
 *
 * The default was 0.2 until 2026-07-28. It is now 0 because ascent's scores are anchored numbers: a
 * customer files them in a briefing, a percentile, or a signed export, and an unchanged repo whose
 * score moves between two filed artifacts destroys the artifact's credibility permanently. Sampling
 * nuance is worth nothing on a number and is still available in the prose the model writes around it.
 * This is `docs/VALUE-CASE.md` D29 (score reproducibility). Note `claude-cli` has NO temperature knob,
 * so it remains non-reproducible regardless of this default — never anchor a customer-facing number on
 * a claude-cli scan.
 * Clamped to [0, 2] — the widest range any of the real providers accepts. An out-of-range value
 * (LLM_TEMPERATURE=5, or a negative) would otherwise flow into the request, 400 EVERY call, and
 * silently degrade 100% of scans to the deterministic mock floor — the identical hard-to-diagnose
 * symptom the MIN_LLM_TIMEOUT_MS floor above was built to kill, so the same hardening policy applies
 * to the whole knob family, not just the timeout. (llm-provider-abstraction #3)
 */
export function llmTemperature(): number {
  return Math.min(2, Math.max(0, envNumber("LLM_TEMPERATURE", 0)));
}

/**
 * Floor for the max-output-token knobs. A 0/negative completion cap is a misconfiguration that makes
 * every real-provider call fail (or return an empty reply), not a tuning choice; 256 is far below any
 * real assessment (a multi-KB JSON) yet enough that a request can complete and surface a diagnosable
 * truncation instead of a silent all-scans-to-mock degrade.
 */
const MIN_LLM_MAX_TOKENS = 256;

/**
 * Per-provider max-output-tokens knob (BEDROCK_MAX_TOKENS / OPENAI_MAX_TOKENS / OPENROUTER_MAX_TOKENS)
 * — same call-time envNumber parsing as every other knob, rounded to an integer and floored to
 * MIN_LLM_MAX_TOKENS so a 0/negative/garbage value can't fail every call. (llm-provider-abstraction #3)
 */
export function llmMaxTokens(envName: string, fallback = 4096): number {
  return Math.max(MIN_LLM_MAX_TOKENS, Math.round(envNumber(envName, fallback)));
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
 * (docs/features/scanning/calibration.md). Unset = zero prompt change = calibration untouched (the display-only path).
 */
export function techStackPromptEnabled(): boolean {
  const v = (process.env.TECH_STACK_PROMPT ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

// ---------------------------------------------------------------------------
// Inference-engine provider vocabulary
// ---------------------------------------------------------------------------

/**
 * Human label per inference-engine provider id — the single source for the /usage "By inference
 * engine" bars and the executive briefing's "Scored by" provenance line (was duplicated as
 * `PROVIDER_META` in usage/page and `ENGINE_LABEL` in lib/org/briefing). The per-provider chart
 * COLOR stays local to /usage (a UI concern); only the id→label vocabulary lives here.
 *
 * Typed as a full Record over ProviderName (intersected with Record<string,string> for legacy ids
 * like "claude" from older persisted scans) so the compiler FLAGS a missing entry when the union
 * grows: openai and openrouter were both first-class ProviderName members whose raw lowercase ids
 * leaked into the two provenance surfaces executives read, because the old `Record<string, string>`
 * typing couldn't notice the gap. (llm-provider-abstraction #4)
 */
export const PROVIDER_LABEL: Record<ProviderName, string> & Record<string, string> = {
  "claude-cli": "Claude CLI",
  claude: "Claude",
  gemini: "Gemini",
  bedrock: "AWS Bedrock",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  mock: "Mock (deterministic)",
};

/** Human label for an inference-engine provider id; unknown ids fall back to the raw id. */
export function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
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
  /**
   * When true, `prefix` must equal the WHOLE candidate id (after geo/vendor-slug stripping), not just
   * a leading substring. Used for the bare claude-cli aliases ("sonnet"/"haiku"/"opus"): those exact
   * strings are the only real claude-cli engineModel values (CLAUDE_MODEL), so plain `startsWith`
   * matching let any self-hosted/OpenAI-compatible model id sharing the prefix (e.g. "opus-7b") get
   * billed at first-party Claude Opus rates in the /usage cost estimate — a real overbill, not a
   * cosmetic mismatch. An unmatched id falls through to "no estimate" (the safe default this table
   * already uses for genuinely unknown models) rather than a guessed rate. (G3-17)
   */
  exact?: boolean;
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
  // `exact: true` — see ModelPrice.exact: a bare prefix match here would overbill a self-hosted or
  // OpenAI-compatible model id that happens to share the word (e.g. "opus-7b"). (G3-17)
  { prefix: "sonnet", inPerMTok: 3, outPerMTok: 15, exact: true },
  { prefix: "haiku", inPerMTok: 1, outPerMTok: 5, exact: true },
  { prefix: "opus", inPerMTok: 5, outPerMTok: 25, exact: true },
  // OpenAI (OPENAI_MODEL default gpt-4o-mini; bare gpt-4o for the obvious upgrade).
  { prefix: "gpt-4o-mini", inPerMTok: 0.15, outPerMTok: 0.6 },
  { prefix: "gpt-4o", inPerMTok: 2.5, outPerMTok: 10 },
  // Claude via OpenRouter ("anthropic/claude-sonnet-4"). priceForModel strips the vendor slug, which
  // leaves `claude-…` — a shape neither the Bedrock (dotted) nor the CLI (bare "sonnet") keys match.
  // Same list rates as the Bedrock tiers above; kept as separate rows so a future divergence is explicit.
  { prefix: "claude-sonnet-4", inPerMTok: 3, outPerMTok: 15 },
  { prefix: "claude-haiku-4", inPerMTok: 1, outPerMTok: 5 },
  { prefix: "claude-opus-4", inPerMTok: 5, outPerMTok: 25 },
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
  // OpenRouter model ids are ALWAYS "vendor/model" slugs (openai/gpt-4o-mini, google/gemini-3-flash,
  // anthropic/claude-sonnet-4), but this table keys on model families. `startsWith` therefore matched
  // nothing for every OpenRouter model, so priceForModel returned null — and a single unpriced model
  // nulls the whole org's /usage cost estimate for the period. Try the vendor-stripped form too.
  const slash = id.indexOf("/");
  const candidates = slash > 0 ? [id, id.slice(slash + 1)] : [id];
  let best: ModelPrice | null = null;
  for (const candidate of candidates) {
    for (const p of MODEL_PRICES) {
      const matches = p.exact ? candidate === p.prefix : candidate.startsWith(p.prefix);
      if (matches && (best === null || p.prefix.length > best.prefix.length)) {
        best = p;
      }
    }
  }
  return best;
}
