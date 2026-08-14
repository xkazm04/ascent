// Scan phase: the LLM assessment leg, with its whole resilience story.
//
// Extracted verbatim from scanRepository (src/lib/scan.ts) so the retry/failover/budget policy is
// readable and testable on its own. Nothing here knows about ingestion, scoring or persistence — it
// takes a finished LlmScoreInput and returns the assessment plus the provenance the report needs:
// WHICH provider actually answered, whether the scan degraded to the deterministic mock floor, the
// token usage of the winning attempt, and the stage latency.
//
// The mock-degrade contract is load-bearing and unchanged: when an LLM was requested and every real
// attempt fails, the returned `provider` is a fresh MockProvider and `llmFailed` is true. Callers key
// caching, billing refunds and the report's warnings off exactly that pair.

import type { ProgressFn } from "@/lib/github/source";
import { MockProvider, providerByName } from "@/lib/llm";
import { isAssessmentUsable } from "@/lib/llm/provider";
import { trackLlmCall } from "@/lib/llm/tracklight";
import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment, TokenUsage } from "@/lib/types";

/** Backoff before a single LLM retry — fixed (no jitter) to keep the scan path deterministic-friendly. */
const LLM_RETRY_MS = 500;
/**
 * Total wall-clock budget for ALL LLM attempts (primary + retry + failover) in one scan. When it
 * expires the in-flight call and every remaining attempt abort and the scan degrades to the
 * deterministic mock floor. An explicit `LLM_TOTAL_BUDGET_MS` env always wins; otherwise the default is
 * PROVIDER-AWARE so a slow provider isn't silently mocked out of the box:
 *   • Fast hosted models (Gemini Flash, Bedrock) → 90s, which sits under a serverless route's
 *     maxDuration so the mock degrade is reached before the platform hard-kills the function.
 *   • `claude-cli` spawns a full local CLI session per call (~6 min median). A 90s budget would abort
 *     EVERY scan into the mock floor before the model ever answered; it runs on a long-lived server
 *     (never serverless), so default it generously (15 min). This makes a stock
 *     `LLM_PROVIDER=claude-cli` deploy stay LIVE with no env tuning, instead of silently mocking.
 */
function llmTotalBudgetMs(providerName: string): number {
  const raw = process.env.LLM_TOTAL_BUDGET_MS;
  const override = raw ? Number(raw) : NaN;
  if (Number.isFinite(override) && override > 0) return override;
  return providerName === "claude-cli" ? 15 * 60_000 : 90_000;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// AWS SDK (Bedrock) exception NAMES that mean the SAME provider cannot succeed on a re-call: bad/absent
// credentials, a malformed request, or a model id that doesn't exist. Throttling / ServiceUnavailable /
// ModelTimeout / ModelNotReady are deliberately ABSENT — those are transient and should still retry.
const HARD_AWS_ERROR_NAMES = new Set([
  "AccessDeniedException",
  "UnauthorizedException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "IncompleteSignatureException",
  "MissingAuthenticationTokenException",
  "ValidationException",
  "ResourceNotFoundException",
  "MalformedInputException",
]);

/** Best-effort HTTP status extraction across the providers' error shapes: AWS SDK `$metadata`, the
 *  Gemini SDK's `status`/`statusCode`, and the fetch-based openai/openrouter adapters, which embed it
 *  in the message ("… request failed (401): …"). Undefined when no status is discoverable. */
function llmErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { $metadata?: { httpStatusCode?: unknown }; status?: unknown; statusCode?: unknown; message?: unknown };
  const meta = e.$metadata?.httpStatusCode;
  if (typeof meta === "number") return meta;
  if (typeof e.status === "number") return e.status;
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.message === "string") {
    const m = /\((\d{3})\)/.exec(e.message);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Classify a provider failure as HARD (unfixable by re-calling the SAME provider) vs transient. Hard =
 * auth/permission, a 4xx client error (bad request / model-not-found), or a missing API key. Transient =
 * everything else: timeouts, 429 rate limits, 5xx, network blips, empty/unusable/parse failures, and
 * anything we can't confidently classify — the CONSERVATIVE default (unknown ⇒ transient) preserves the
 * current retry behavior for anything ambiguous. Inspect the shapes the providers in src/lib/llm/*
 * actually throw (AWS SDK exception names, an embedded HTTP status, the "… is not set" key guard).
 */
export function isHardLlmError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";

  // An abort (client disconnect, our own per-call timeout, or the scan-wide budget) is never a HARD
  // provider fault — a timeout is transient and abort handling is separate upstream.
  if (name === "AbortError" || name === "TimeoutError") return false;

  // AWS SDK (Bedrock) typed exceptions.
  if (HARD_AWS_ERROR_NAMES.has(name)) return true;

  // A 4xx CLIENT error can't be fixed by re-calling the same provider — EXCEPT 408 (request timeout) and
  // 429 (rate limit), which are transient and should still retry.
  const status = llmErrorStatus(err);
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return true;

  // Message fingerprints for the providers without a typed status (fetch-based + claude-cli):
  const m = message.toLowerCase();
  if (m.includes("is not set")) return true; // missing API-key guard (gemini/openai/openrouter)
  if (/(unauthorized|not authorized|permission denied|access denied|invalid api key|authentication failed|forbidden)/.test(m)) {
    return true;
  }
  if (/(model[_ ]?not[_ ]?found|unknown model|no such model|does not exist|is not supported)/.test(m)) return true;

  return false;
}

/**
 * Decide whether the SAME-provider retry step should run, given the last error and the remaining
 * scan-wide LLM budget. Two reasons to skip it and go straight to failover:
 *   1. HARD failure — re-calling the same provider will fail the same way, burning an attempt that a
 *      tight (90s hosted) budget needs for the fallback.
 *   2. Budget guard — never START a retry that would leave the fallback step unable to run afterward.
 *      A failover to a DIFFERENT provider is likelier to succeed than re-calling the same one, so when
 *      the remaining budget can't fit BOTH a retry and the fallback (⅓ of the total budget reserved per
 *      step), the retry yields the scarce budget to the fallback. With no fallback configured there's
 *      nothing to preserve, so a transient failure still retries (the attempt is deadline-bounded).
 */
export function shouldRetrySameProvider(opts: {
  lastError: unknown;
  hasFallback: boolean;
  remainingBudgetMs: number;
  totalBudgetMs: number;
}): boolean {
  if (isHardLlmError(opts.lastError)) return false;
  if (opts.hasFallback && opts.remainingBudgetMs < Math.floor(opts.totalBudgetMs / 3) * 2) return false;
  return true;
}

export interface AssessPhaseInput {
  /** The provider selected for this scan (already org-resolved / force-mocked upstream). */
  provider: LLMProvider;
  /** Its name captured BEFORE any failover — what the user was promised, and the budget's basis. */
  intendedProvider: string;
  /** BYOM scan: never fail over to the PLATFORM provider (privacy-strict, §8.2) — retry, then mock. */
  byomScan: boolean;
  scoreInput: LlmScoreInput;
  /** Dimension count the assessment must plausibly cover (the usability gate's denominator). */
  expectedDimensions: number;
  /** owner/repo for LightTrack telemetry — the per-repo dimension of the LLM-cost rollup. */
  repoFullName: string;
  orgSlug?: string;
  /** The CLIENT abort signal (disconnect). Distinct from the internal budget deadline. */
  signal?: AbortSignal;
  emit: ProgressFn;
}

export interface AssessPhaseResult {
  assessment: LlmAssessment;
  /** The provider that actually produced the assessment — becomes the report's engine. A fresh
   *  MockProvider here means the scan is on the deterministic floor. */
  provider: LLMProvider;
  /** An LLM was expected and every real attempt failed. False for an intentional/keyless mock. */
  llmFailed: boolean;
  /** Token usage of the attempt that SUCCEEDED (empty when the scan degraded) — the metering basis. */
  usage: TokenUsage;
  /** Wall-clock of the whole LLM stage, including failed attempts and backoff. */
  latencyMs: number;
}

/**
 * Run the LLM scoring stage: primary → one bounded same-provider retry → configured failover →
 * deterministic mock, all under a single scan-wide wall-clock budget. Emits stage progress and
 * mirrors every real attempt to LightTrack. Throws only on a CLIENT abort (the scan is abandoned);
 * every provider failure is absorbed into the mock degrade.
 */
export async function runAssessmentPhase(input: AssessPhaseInput): Promise<AssessPhaseResult> {
  const { provider, intendedProvider, byomScan, scoreInput, expectedDimensions, repoFullName, signal, emit } = input;

  let llmFailed = false;
  emit({
    stage: "score",
    message:
      intendedProvider === "mock"
        ? "Scoring against the rubric…"
        : `Scoring with ${intendedProvider}…`,
    pct: 72,
  });
  signal?.throwIfAborted();
  // One assess attempt, with the quality gate inlined: validateAssessment() never throws, so a
  // parseable-but-empty reply ({}, wrong shape, or all-unknown dimension ids) coerces to an
  // assessment scoring (almost) no dimensions. Left unchecked it would render the deterministic
  // floor under the provider's name with no caveat. Treat it exactly like a thrown failure so the
  // retry/failover below can recover. (Mock is never gated — it always returns a full assessment.)
  // Capture token usage from the call that ultimately succeeds — the metering basis. Each attempt's
  // onUsage overwrites this; a thrown attempt never reports, so the winning provider's usage stands.
  let capturedUsage: TokenUsage = {};
  // `moreAttemptsAfter` is supplied by the resilience loop below: only IT knows whether another plan
  // step will actually run after this failure, and that is precisely what makes the tracked event's
  // `degraded` flag honest (a failed primary that a retry recovers did NOT degrade the scan; the last
  // failing attempt did). Without it the degradation rate is either unobservable or overstated.
  const attemptAssess = async (
    p: LLMProvider,
    attemptSignal: AbortSignal | undefined,
    moreAttemptsAfter: (err: unknown) => boolean,
  ) => {
    // Capture this attempt's usage into a LOCAL and commit it to capturedUsage only AFTER the
    // attempt is proven usable. Providers call onUsage BEFORE the parse/usability check, so a failed
    // attempt (malformed JSON, unusable coverage) would otherwise leave its tokens on report.usage
    // even though the scan degraded to mock — billing the user for an attempt that never contributed.
    let attemptUsage: TokenUsage = {};
    // Per-attempt wall-clock for the tracklight latency metric (distinct from the whole-stage
    // llmLatencyMs persisted on the report — this times THIS provider call, incl. failed ones).
    const attemptStartedAt = Date.now();
    try {
      const a = await p.assess(scoreInput, { signal: attemptSignal, onUsage: (u) => { attemptUsage = u; } });
      if (p.name !== "mock" && !isAssessmentUsable(a, expectedDimensions)) {
        throw new Error(
          `LLM returned an unusable assessment (${a.dimensions.length}/${expectedDimensions} dimensions scored).`,
        );
      }
      // Mirror the successful real LLM call to LightTrack (fire-and-forget; a no-op unless configured).
      // Mock carries no real provider traffic/cost, so it's never tracked.
      if (p.name !== "mock") {
        trackLlmCall({
          provider: p.name,
          model: p.model,
          usage: attemptUsage,
          latencyMs: Date.now() - attemptStartedAt,
          status: "success",
          // This call produced a USABLE assessment (the coverage guard above already ran), so the
          // report it backs is not on the deterministic floor.
          degraded: false,
          repo: repoFullName,
          org: input.orgSlug,
        });
      }
      capturedUsage = attemptUsage; // commit only on success
      return a;
    } catch (err) {
      // Track failed real attempts too — the tokens may have been spent at the provider (an
      // unusable-but-answered response) and the error/latency is the signal that drives the
      // retry/failover. Skip only a CLIENT disconnect (the scan is abandoned, not a provider fault).
      if (p.name !== "mock" && !signal?.aborted) {
        trackLlmCall({
          provider: p.name,
          model: p.model,
          usage: attemptUsage,
          latencyMs: Date.now() - attemptStartedAt,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          // Degraded only when nothing else will run after this failure — i.e. THIS call is the one
          // that drops the scan to the deterministic floor.
          degraded: !moreAttemptsAfter(err),
          repo: repoFullName,
          org: input.orgSlug,
        });
      }
      throw err;
    }
  };

  // Resilience: a transient blip (rate limit / timeout) or a one-off unusable reply should not
  // permanently degrade a paid scan to the deterministic floor. Try the primary provider, then one
  // bounded retry of it, then a configured LLM_FALLBACK_PROVIDER (e.g. bedrock → gemini) when set
  // and different — only THEN the mock degrade. Aborts propagate immediately so an abandoned scan
  // stops. The provider that actually produced the assessment becomes the report's engine.
  const llmStartedAt = Date.now();
  let assessment: LlmAssessment;
  let usedProvider: LLMProvider = provider;
  // Scan-wide LLM deadline. Each attempt enforces its own per-call timeout (LLM_TIMEOUT_MS), but the
  // resilience plan (primary + retry + failover) MULTIPLIES them — three ~60s attempts can burn ~181s
  // and blow the serverless function timeout BEFORE the mock degrade ever runs, so the user gets a 500
  // instead of the deterministic floor. Cap the TOTAL time across attempts: when the budget expires the
  // in-flight call and every remaining attempt abort, and we fall through to mock — well under the
  // platform limit. The budget signal is distinct from the client's `signal` so a budget expiry
  // degrades to mock while a real client disconnect still unwinds the whole scan.
  const totalBudgetMs = llmTotalBudgetMs(intendedProvider);
  const llmDeadline = new AbortController();
  const llmDeadlineTimer = setTimeout(
    () => llmDeadline.abort(new Error("LLM total budget exceeded")),
    totalBudgetMs,
  );
  const budgetRemainingMs = () => totalBudgetMs - (Date.now() - llmStartedAt);
  const llmSignal = signal ? AbortSignal.any([signal, llmDeadline.signal]) : llmDeadline.signal;
  try {
    // BYOM scans never fall over to the PLATFORM provider (that would send the org's data to Ascent's
    // account, defeating the privacy guarantee) — they retry the org's Bedrock, then degrade to mock.
    const fallback =
      intendedProvider === "mock" || byomScan ? null : providerByName(process.env.LLM_FALLBACK_PROVIDER);
    // Steps are tagged by kind so the loop can skip the SAME-provider retry when it can't help (a HARD
    // error) or can't afford to run (budget needed for the failover) — see shouldRetrySameProvider.
    const plan: { p: LLMProvider; kind: "primary" | "retry" | "fallback"; note?: string }[] = [
      { p: provider, kind: "primary" },
    ];
    if (intendedProvider !== "mock")
      plan.push({ p: provider, kind: "retry", note: `Retrying ${intendedProvider}…` });
    if (fallback && fallback.name !== intendedProvider)
      plan.push({ p: fallback, kind: "fallback", note: `Falling over to ${fallback.name}…` });
    const hasFallback = plan.some((s) => s.kind === "fallback");
    // Will ANY step after index `i` actually run, given this error? Mirrors the two skip rules the
    // loop applies below (budget exhausted → break; a retry the budget/error class rules out →
    // continue), so the tracked `degraded` flag matches what the scan really does next.
    const moreAttemptsAfter = (i: number, err: unknown): boolean => {
      if (llmDeadline.signal.aborted) return false;
      return plan
        .slice(i + 1)
        .some(
          (s) =>
            s.kind !== "retry" ||
            shouldRetrySameProvider({ lastError: err, hasFallback, remainingBudgetMs: budgetRemainingMs(), totalBudgetMs }),
        );
    };

    let resolved: LlmAssessment | null = null;
    let lastErr: unknown;
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]!; // safe: i bounded by plan.length
      // Budget-aware retry: a HARD failure (auth/4xx/model-not-found) can't be fixed by re-calling the
      // same provider, and a retry must never start when the remaining budget is needed for the
      // fallback. Either way, skip straight to the failover step (or to mock when none is configured).
      if (
        step.kind === "retry" &&
        !shouldRetrySameProvider({ lastError: lastErr, hasFallback, remainingBudgetMs: budgetRemainingMs(), totalBudgetMs })
      ) {
        continue;
      }
      try {
        if (i > 0) {
          if (llmDeadline.signal.aborted) break; // budget spent — don't sleep before a doomed attempt
          await sleep(LLM_RETRY_MS);
          signal?.throwIfAborted();
          emit({ stage: "score", message: step.note ?? "Retrying…", pct: 80, provider: step.p.name });
        }
        resolved = await attemptAssess(step.p, llmSignal, (err) => moreAttemptsAfter(i, err));
        usedProvider = step.p;
        break;
      } catch (err) {
        // CLIENT disconnect mid-call — don't spend further attempts + a compose pass on a report
        // nobody will receive. Propagate so the whole scan unwinds. A BUDGET (deadline) abort is NOT
        // a client abort: it falls through to the next step (which aborts fast) and then to mock.
        if (signal?.aborted) throw err;
        lastErr = err;
      }
    }

    if (resolved) {
      assessment = resolved;
    } else {
      // Every real attempt failed (or the budget expired) — degrade to deterministic. Only flag it
      // when an LLM was actually expected (not an intentional/keyless mock).
      llmFailed = intendedProvider !== "mock";
      if (llmFailed) {
        console.error("[scan] LLM provider failed after retry/failover, using mock:", lastErr);
        emit({
          stage: "score",
          message: "Model unavailable, showing deterministic scores.",
          pct: 90,
          fallback: true,
        });
      }
      usedProvider = new MockProvider();
      // Honor the client signal here too (the degrade path is the one most likely to run after a
      // disconnect) so the cancellation contract is uniform across providers.
      assessment = await usedProvider.assess(scoreInput, { signal });
    }
  } finally {
    clearTimeout(llmDeadlineTimer);
  }

  return {
    assessment,
    provider: usedProvider,
    llmFailed,
    usage: capturedUsage,
    latencyMs: Date.now() - llmStartedAt,
  };
}
