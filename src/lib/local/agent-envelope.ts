// THE `claude -p --output-format json` ENVELOPE, parsed — pure, so the whole of it is testable
// without a subprocess in the room.
//
// WHY THIS IS ITS OWN MODULE. `agent.ts` is a spawn wrapper: argv, timeouts, stream caps, consent.
// Until now its `close` handler also did the parsing, typed as `{result?, is_error?, subtype?}` — so
// the cost, the token counts, the turn count, the wall time and the session id the CLI reports on
// every session were read past and dropped at the process boundary. That is the one measurement the
// loop cannot reconstruct afterwards: git history says what changed, and nothing anywhere says what
// it cost. Parsing it here keeps `agent.ts` a spawn wrapper and makes the envelope a table test.
//
// HONEST NULLS, THROUGHOUT. A field the envelope omits — or carries as something that is not a finite
// number — is `null`, never 0. `0` is a measurement ("this session was free") and would be averaged
// as one; `null` says "the CLI did not tell us". The two are different rows in the price list, and
// `total_cost_usd: 0` (a real zero the CLI reported, e.g. a refusal that spent nothing) is kept as a
// real 0 precisely because the distinction is the point.
//
// A FAILED SESSION STILL REPORTS ITS COST. A run that burned two dollars and produced nothing is the
// most important row in the remediation ledger, so `ok: false` never blanks the measurements.

/** Micro-cents per USD: `round(total_cost_usd * 100 * 1e6)`. A 0.4¢ session must not round to zero,
 *  and every display divides by this rather than storing a float. Exported so the stream parser prices
 *  a `result` event with the same constant, never a second copy of it. */
export const MICROS_PER_USD = 100 * 1_000_000;

/** The ceiling on `AgentRunResult.errorText` — enough for the CLI's own sentence and a stack line or
 *  two, never a transcript in a DB column. */
export const ERROR_TEXT_MAX = 2_048;

export interface AgentEnvelope {
  ok: boolean;
  /** The session's final text (`.result`), or the failure reason — unchanged from the old behaviour. */
  summary: string;
  /** The model the envelope itself reported, else the one we asked for. Never invented. */
  model: string | null;
  /** MICRO-CENTS. `null` when the envelope carried no finite `total_cost_usd`; that is not 0. */
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  turns: number | null;
  durationMs: number | null;
  /** The CLI's own `session_id`. A JOIN KEY ONLY — never a licence to add an OTLP row's cost here. */
  sessionId: string | null;
}

export interface ParseEnvelopeOptions {
  /** The model the caller asked the CLI for — the fallback when the envelope does not name one. */
  fallbackModel: string;
  /** The child's exit code, for the "no JSON at all" message. */
  exitCode: number | null;
  /** Whatever the child wrote to stderr, for the same message. */
  stderr: string;
  /** The CLI's own error words seen in the STREAM before it ended (a synthetic assistant message — the
   *  session-limit sentence arrives that way), for a result that carries none. Optional: absent means
   *  exactly what every parse before streaming did. */
  errorHint?: string | null;
}

/** A finite number, or null. Strings are accepted because the CLI has shipped both encodings for
 *  `total_cost_usd`; anything else (including NaN and Infinity) is "not reported". */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A non-negative integer count, or null. Fractional counts are rounded; negatives are not counts. */
function count(v: unknown): number | null {
  const n = num(v);
  if (n == null || n < 0) return null;
  return Math.round(n);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The `usage` block, under the several names the CLI has used for the cache-read class. */
function usageOf(raw: unknown): { input: number | null; output: number | null; cacheRead: number | null } {
  if (!raw || typeof raw !== "object") return { input: null, output: null, cacheRead: null };
  const u = raw as Record<string, unknown>;
  return {
    input: count(u.input_tokens ?? u.inputTokens),
    output: count(u.output_tokens ?? u.outputTokens),
    cacheRead: count(u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? u.cache_read_tokens),
  };
}

/**
 * The model, from the envelope's own report.
 *
 * Two encodings exist in the wild: a top-level `model`, and a `modelUsage` map keyed by model id.
 * The map's FIRST key is taken when there is exactly one — a session that genuinely used two models
 * has no single answer, and picking one would be a fabrication. Falls back to what we asked for,
 * which is the honest reading of "the CLI did not say, and this is what we requested".
 */
function modelOf(env: Record<string, unknown>, fallback: string): string | null {
  const direct = str(env.model);
  if (direct) return direct;
  const usage = env.modelUsage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const keys = Object.keys(usage as Record<string, unknown>);
    if (keys.length === 1 && keys[0]) return keys[0];
  }
  return str(fallback);
}

/**
 * Parse one session's stdout. NEVER throws: non-JSON output is a failed session with every
 * measurement `null`, which is exactly what it is.
 */
export function parseAgentEnvelope(raw: string, opts: ParseEnvelopeOptions): AgentEnvelope {
  const blank: AgentEnvelope = {
    ok: false,
    summary: "",
    model: null,
    costMicros: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    turns: null,
    durationMs: null,
    sessionId: null,
  };

  const env = envelopeObject(raw);
  if (!env) {
    // A stream that never produced its `result` hands over "" here, so the sentence carries the hint or
    // stderr — exactly what a one-shot session that printed nothing always did.
    const said = raw || str(opts.errorHint) || opts.stderr;
    return {
      ...blank,
      summary: `Agent exited (${opts.exitCode}) without a JSON envelope: ${said.trimStart().slice(0, 300) || "(no output)"}`,
    };
  }
  const usage = usageOf(env.usage);
  const usd = num(env.total_cost_usd ?? env.totalCostUsd);
  const measured = {
    model: modelOf(env, opts.fallbackModel),
    // `0` survives here deliberately: the CLI reported a cost of zero, which is a measurement. Only
    // an ABSENT / non-finite figure becomes null.
    costMicros: usd == null ? null : Math.round(usd * MICROS_PER_USD),
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    turns: count(env.num_turns ?? env.numTurns),
    durationMs: count(env.duration_ms ?? env.durationMs),
    sessionId: str(env.session_id ?? env.sessionId),
  };

  const result = env.result;
  if (env.is_error === true || typeof result !== "string") {
    const subtype = str(env.subtype) ?? "unknown";
    // THE CLI'S OWN WORDS, first line FIRST. The lane log keeps only the summary's first line, so a
    // failure whose text was empty (or began with a blank line) used to log "Agent error (success): "
    // and nothing else — hiding "You've hit your session limit" from the breaker that reads the log.
    const reason = str(result) ?? errorWordsOf(env) ?? str(opts.errorHint) ?? opts.stderr;
    return { ...measured, ok: false, summary: `Agent error (${subtype}): ${reason.trimStart().slice(0, 500)}` };
  }
  return { ...measured, ok: true, summary: result.slice(0, 4_000) };
}

/** The raw text as an envelope object, or null when it is not one. Never throws. */
function envelopeObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The newer CLIs' `errors: string[]` on an error-subtype result, joined — or null. */
function errorWordsOf(env: Record<string, unknown>): string | null {
  if (!Array.isArray(env.errors)) return null;
  return str(env.errors.filter((e): e is string => typeof e === "string" && e.trim() !== "").join("\n"));
}

/**
 * THE CLI'S OWN ERROR TEXT for a failed session, bounded to `ERROR_TEXT_MAX` — what the runner's
 * session-limit breaker classifies. In order: the result's own text (a failed session's `result` IS the
 * CLI's sentence), the newer `errors` list, the stream's error hint, then stderr; for output that was
 * never an envelope at all, that output itself first (it is what the CLI printed). Null when nothing
 * was said anywhere. Only meaningful on a failure — the caller does not ask on success.
 */
export function agentErrorText(raw: string, opts: { stderr: string; errorHint?: string | null }): string | null {
  const env = envelopeObject(raw);
  const text = env
    ? (str(env.result) ?? errorWordsOf(env) ?? str(opts.errorHint) ?? str(opts.stderr))
    : (str(raw) ?? str(opts.errorHint) ?? str(opts.stderr));
  return text ? text.trim().slice(0, ERROR_TEXT_MAX) : null;
}
