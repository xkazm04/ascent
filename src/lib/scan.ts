// Top-level scan orchestrator: URL -> ingest -> deterministic signals -> LLM assess
// -> assembled report. Emits progress at each stage (for SSE) and falls back to the
// MockProvider if the LLM call fails OR returns an empty/unusable assessment, so a scan
// always returns a usable report and flags when the AI layer didn't really contribute.

import {
  GitHubError,
  GitHubPublicSource,
  parseRepoUrl,
  type ParsedRepo,
  type ProgressFn,
  type RepoSource,
} from "@/lib/github/source";
import { analyzeSignals, classifyArchetype, detectAiUsage, offPlatformReview } from "@/lib/analyze";
import { detectStackFit } from "@/lib/analyze/stack-fit";
import { extractTechStack } from "@/lib/analyze/tech-extract";
import { buildPassport } from "@/lib/analyze/passport";
import { applyGovernanceSignals, applyPrSignals, fetchPrStats } from "@/lib/analyze/pulls";
import { fetchBranchGovernance, fetchCommitActivity } from "@/lib/github/governance";
import { fetchSecurityPosture } from "@/lib/github/security-posture";
import { fetchSecurityExposure } from "@/lib/security/exposure";
import { computeSecurityChecks } from "@/lib/security/checks";
import { getProvider, getProviderForOrg, providerByName, MockProvider } from "@/lib/llm";
import { techStackPromptEnabled } from "@/lib/llm/config";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { isAssessmentUsable } from "@/lib/llm/provider";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { matrixCaptureEnabled, captureMatrixInput } from "@/lib/llm/matrix-capture";
import { captureAssessment, evalLogEnabled } from "@/lib/llm/eval-log";
import { trackLlmCall } from "@/lib/llm/tracklight";
import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { assembleReport } from "@/lib/scoring/engine";
import { DIMENSIONS } from "@/lib/maturity/model";
import { extractTeamOwnership } from "@/lib/github/codeowners";
import type { Governance, PrStats, ScanReport, SecurityExposure, SecurityPosture, TokenUsage } from "@/lib/types";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { decisionsForRepo, getInstallationIdForOwner } from "@/lib/db";
import { canMintInstallationToken } from "@/lib/authz";

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

export interface ScanOptions {
  token?: string;
  mock?: boolean;
  /**
   * Owning org slug (BYOM — Feature 1). When set to a real org with an ACTIVE Bedrock config, the scan
   * runs on the org's own Bedrock (its AWS account/bill) and the platform fallback is suppressed (fail
   * to mock, §8.2). Omitted / "public" uses the env-driven platform provider, unchanged.
   */
  orgSlug?: string;
  /**
   * Where to read STANDING DECISIONS from (individual tier, decision 5). Defaults to `orgSlug`
   * (org scans keep reading their own org). The public funnel sets this to the signed-in viewer's
   * PERSONAL org so their accepted/dismissed findings calibrate THEIR rescans — decisions are read
   * per-viewer, never from other individuals' workspaces. Note the resulting report is still the
   * SHARED public-corpus scan (persisted under "public", commit-deduped, possibly served to
   * coalesced concurrent callers): a decision is calibration context the prompt explicitly frames
   * as "not a reason to raise the score", not a private re-scoring.
   */
  decisionOrgSlug?: string;
  /**
   * When true, do NOT fall back to the ambient `process.env.GITHUB_TOKEN` if no explicit `token`
   * is given. Public, unauthenticated surfaces (the README badge) set this so a private repo can't
   * be ingested with the operator's server PAT — otherwise an anonymous caller could read a
   * private repo's maturity. Token-less ingestion of a private repo simply 404s → neutral badge.
   */
  noAmbientToken?: boolean;
  source?: RepoSource;
  now?: string; // injectable timestamp (tests / determinism)
  onProgress?: ProgressFn;
  /**
   * Git ref to ingest (branch, tag, or commit SHA). Defaults to the repo's default branch.
   * Pass a PR's head SHA to score what the pull request changes — the basis of the per-PR
   * maturity gate (see /api/app/webhook). The report's `repo.defaultBranch` still reports the
   * true default; governance/PR-stats enrichment remains repo-level.
   */
  ref?: string;
  /**
   * Head commit sha already resolved for the cache key (by lookupCachedScan). Pins ingestion to
   * that exact commit so the scored snapshot matches the key even if a push lands between the head
   * lookup and this read, and stamps it as the report's canonical commit identity. Ignored when an
   * explicit `ref` (PR gating) is supplied — that wins.
   */
  headSha?: string;
  /**
   * Aborts all in-flight scan work (GitHub ingest, governance/PR/activity, and the LLM call)
   * when the client disconnects. Wire the route's `request.signal` here so an abandoned scan
   * stops burning the function's duration budget, GitHub rate limit, and LLM spend.
   */
  signal?: AbortSignal;
}

/**
 * Resolve a private-repo installation token (and the owning org slug for persistence).
 * Shared by the JSON and streaming scan routes.
 */
export async function resolveScanAuth(
  parsed: ParsedRepo | null,
  installationId?: string,
): Promise<{ token?: string; orgSlug: string; noAmbientToken?: boolean }> {
  if (!parsed || !isAppConfigured()) return { orgSlug: "public" };

  // AUTHORIZE before minting. The previous guard was `!isAuthConfigured() || sessionOwnsOrg(owner)`,
  // keyed on the DORMANT custom-OAuth env that production leaves unset — so `!false` allowed EVERY
  // caller (and honored any caller-supplied, enumerable installationId) to mint that installation's
  // token and read a private repo's maturity. canMintInstallationToken resolves real membership
  // against the ACTIVE Supabase wall.
  const ownerInstallationId = (await getInstallationIdForOwner(parsed.owner)) ?? undefined;

  // Not an installed org: nothing to mint, and the repo is reachable only if public. Keep the
  // ambient GITHUB_TOKEN here — the anonymous public-scan funnel depends on it for GitHub rate limits.
  if (!ownerInstallationId) return { orgSlug: "public" };

  // From here the owner IS an installed org, so its repos may be private. When the caller may not
  // mint, we must ALSO refuse the ambient GITHUB_TOKEN: that operator PAT commonly has broad read
  // access, so falling back to it would leak exactly the private repo the mint gate just denied.
  // Token-less ingestion of a private repo simply 404s (neutral), which is the intended outcome.
  if (!(await canMintInstallationToken(parsed.owner))) {
    return { orgSlug: "public", noAmbientToken: true };
  }

  // A caller-supplied installation id is only ever a hint for THIS owner. Honoring an arbitrary id
  // was the cross-tenant IDOR: pass a victim's (enumerable) id, receive a token minted for it.
  if (installationId && String(installationId) !== String(ownerInstallationId)) {
    return { orgSlug: "public", noAmbientToken: true };
  }

  try {
    return { token: await getInstallationToken(ownerInstallationId), orgSlug: parsed.owner.toLowerCase() };
  } catch {
    // Mint failed for an authorized member — still never downgrade to the operator PAT.
    return { orgSlug: "public", noAmbientToken: true };
  }
}

export async function scanRepository(input: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const parsed = parseRepoUrl(input);
  if (!parsed) {
    throw new GitHubError(
      "INVALID_URL",
      "Enter a valid GitHub repository URL, e.g. https://github.com/owner/repo.",
    );
  }
  // Resolve the provider up front so every progress event can carry provider-aware copy —
  // the loading UI renders "Asking Gemini…" / "Querying Bedrock in us-east-1…" from these
  // fields, starting with the very first frame. Construction is side-effect-free: no network
  // call or SDK load happens until assess() runs.
  // Org-aware provider selection (BYOM — Feature 1): a real org with an active Bedrock config scans on
  // its own Bedrock; otherwise the env-driven platform provider. `byomScan` suppresses the platform
  // fallback below so a BYOM failure degrades to mock only (privacy-strict, §8.2) — never the platform.
  const providerSelection = await getProviderForOrg(opts.orgSlug, { forceMock: opts.mock });
  let provider: LLMProvider = providerSelection.provider;
  const byomScan = providerSelection.byom;
  const intendedProvider = provider.name;
  const providerRegion = provider instanceof BedrockProvider ? provider.region : undefined;

  // Decorate every emitted event with the intended provider/region (an event may override
  // them), so the SSE consumer never has to guess which model is running.
  const baseEmit = opts.onProgress ?? (() => {});
  const emit: ProgressFn = (p) =>
    baseEmit({ provider: intendedProvider, region: providerRegion, ...p });

  const source = opts.source ?? new GitHubPublicSource();
  const token = opts.token ?? (opts.noAmbientToken ? undefined : process.env.GITHUB_TOKEN);
  // Honor client disconnect: every downstream fetch is wired to this signal, and we re-check it
  // at each stage boundary so an abandoned scan stops before the next expensive leg.
  const signal = opts.signal;
  signal?.throwIfAborted();

  // Pull-request ingestion (GraphQL) runs in parallel with the REST snapshot fetch, then is
  // awaited before analysis so PR signals fold into the dimension scores (F4). GraphQL needs a
  // token — skip gracefully (null) when scanning anonymously.
  const prPromise: Promise<{ stats: PrStats; partial: boolean } | null> = token
    ? fetchPrStats(parsed.owner, parsed.repo, token, signal).catch((err) => {
        console.error("[scan] PR ingestion failed:", err);
        return null;
      })
    : Promise.resolve(null);

  // Pin ingestion to the head sha already resolved for the cache key (when there is one) so the
  // scored snapshot matches that key even if a push lands between the head lookup and this read;
  // an explicit PR `ref` still takes precedence. Then stamp the resolved commit as the report's
  // canonical identity — fetchSnapshot otherwise records treeRes.sha, the tree object's sha, not
  // the commit's — so lookup, scan, cache, and persistence all reference the same commit.
  const pinnedRef = opts.ref ?? opts.headSha;
  const snapshot = await source.fetchSnapshot(parsed, { token, onProgress: emit, signal, ref: pinnedRef });
  if (!opts.ref && opts.headSha) snapshot.meta.headSha = opts.headSha;
  signal?.throwIfAborted();

  // Governance (branch protection / rulesets) + commit activity need the default branch from
  // the snapshot, so they start now and run alongside the LLM call. Governance folds into the
  // score (awaited before analysis); activity is display-only (awaited at compose time).
  const govPromise: Promise<Governance | null> = token
    ? fetchBranchGovernance(parsed.owner, parsed.repo, snapshot.meta.defaultBranch, token, signal).catch(() => null)
    : Promise.resolve(null);
  // GitHub-native security posture (published advisories + org-level security policy) — fed to the
  // Security (D9) check battery below (the Security-Policy check). Public reads, token-gated.
  const secPromise: Promise<SecurityPosture | null> = token
    ? fetchSecurityPosture(parsed.owner, parsed.repo, token, signal).catch(() => null)
    : Promise.resolve(null);
  // Current EXPOSURE — open known vulns from OSV (parsed from the committed npm lockfile). The
  // "open vulns are the real negative" axis, kept separate from posture; degrades to UNKNOWN.
  const expPromise: Promise<SecurityExposure | null> = token
    ? fetchSecurityExposure(parsed.owner, parsed.repo, snapshot.meta.headSha ?? snapshot.meta.defaultBranch, token, signal).catch(() => null)
    : Promise.resolve(null);
  const activityPromise: Promise<number[] | null> = token
    ? fetchCommitActivity(parsed.owner, parsed.repo, token, signal).catch(() => null)
    : Promise.resolve(null);

  emit({ stage: "analyze", message: `Analyzing signals across ${DIMENSIONS.length} dimensions…`, pct: 62 });
  const [prResult, governance, securityPosture, securityExposure] = await Promise.all([prPromise, govPromise, secPromise, expPromise]);
  const prStats = prResult?.stats ?? null;
  // graphql.ts sets `partial` when the PR page came back truncated (null nodes / an `errors` array on a
  // 200). It documented that such results must not be treated as authoritative or cached — and then no
  // consumer read it, so a truncated slice silently deflated D6/D7/D8 on large or rate-limited repos.
  const prPartial = prResult?.partial ?? false;
  // Resolve the scan timestamp up front and thread it through signal extraction, so D7's
  // recency bonus is deterministic (and the same `now` stamps the report below).
  const now = opts.now ?? new Date().toISOString();
  const detectorWarnings: string[] = [];
  const baseSignals = applyGovernanceSignals(
    applyPrSignals(analyzeSignals(snapshot, now, detectorWarnings), prStats, {
      // Suppress the misleading GitHub reviewedRate when review runs off-platform (Gerrit/bors) — the
      // gate is credited positively in the D6 detector from the same commit trailers.
      offPlatformReview: offPlatformReview(snapshot.commits) != null,
    }),
    governance,
  );
  // Security (D9) is scored by the DETERMINISTIC check battery (OpenSSF-Scorecard-style: graded,
  // risk-weighted, auditable) rather than the file-grep detector + LLM blend. It reads the full
  // workflow set + governance + posture + exposure, and its result REPLACES the D9 signal, flagged
  // `deterministic` so the engine takes the number as-is (the LLM only narrates D9, per the framework).
  const securityAssessment = computeSecurityChecks(snapshot, governance, securityPosture, securityExposure);
  const signals = baseSignals.map((s) =>
    s.id === "D9"
      ? { ...s, signalScore: securityAssessment.d9, deterministic: true, gaps: securityAssessment.gaps, signals: securityAssessment.evidence.map((label) => ({ label })) }
      : s,
  );
  const archetype = classifyArchetype(snapshot);
  // Stack-fit (ML/notebook · mobile · embedded) is a known blind spot of the web/service-tuned rubric.
  // Detect it HERE — before the assessment — and thread it into the prompt so the model's roadmap +
  // discrepancy audit calibrate to the stack instead of judging notebooks on web conventions. Detected
  // once and reused for the user-facing warning below. [Tiger P0-2]
  const stackFit = detectStackFit(snapshot);
  // Tech-stack detection (Feature 3a): computed once here from the already-fetched manifests/tree.
  // Always attached to the report (display/persist); fed into the PROMPT only when the gated
  // TECH_STACK_PROMPT flag is on (Option B) — default off keeps scans byte-identical.
  const techStack = extractTechStack(snapshot);

  // Standing decisions already made about this repo (accepted/dismissed/snoozed findings and WHY).
  // Best-effort: a decision store that's unreachable must never fail a scan, and an unscoped
  // ("public") scan simply has none. This closes the Shared Org Memory loop — the human's reason for
  // dismissing a finding becomes context the next assessment reads instead of re-raising the gap.
  // decisionOrgSlug (individual tier) points the read at the TRIGGERING viewer's personal org on the
  // public funnel; org scans keep reading their own org via the orgSlug fallback.
  const decisionSlug = opts.decisionOrgSlug ?? opts.orgSlug;
  const orgDecisions = decisionSlug
    ? await decisionsForRepo(decisionSlug, `${snapshot.meta.owner}/${snapshot.meta.name}`).catch(() => [])
    : [];

  const scoreInput: LlmScoreInput = {
    repo: snapshot.meta,
    signals,
    files: snapshot.files,
    commitSample: snapshot.commits.map((c) => c.message).slice(0, 15),
    archetype,
    ...(orgDecisions.length > 0 ? { orgDecisions } : {}),
    // Already fetched above and folded into the deterministic D3/D6/D7/D8 scores — also hand them to
    // the LLM auditor so it reasons about review/governance with the real evidence (MAT-1).
    prStats,
    governance,
    // The deterministic Security (D9) check battery — its score is FIXED (D9 is `deterministic`); the
    // LLM's job is to narrate it (summary + prioritized gaps) from the same graded evidence, not to
    // re-derive the number. Threaded so the D9 narrative matches the computed score/checks.
    securityAssessment,
    // Name the stack the rubric under-reads so the model weights the affected dimensions accordingly.
    stackFit,
    // Option B (gated): include the detected stack in the prompt only when explicitly enabled.
    ...(techStackPromptEnabled() ? { techStack } : {}),
  };

  // Model-matrix capture (dev/bench only, gated on ASCENT_MATRIX_CAPTURE_DIR): dump the fully-built
  // {scoreInput, snapshot} so the model-comparison bench can replay assess() across models on identical
  // inputs. Best-effort, no-op in production. Runs BEFORE assess() so a capture scan can force the mock
  // provider (no LLM key needed) and still record a real input.
  if (matrixCaptureEnabled()) {
    captureMatrixInput({ repo: `${parsed.owner}/${parsed.repo}`, at: now, scoreInput, snapshot });
  }

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
  // owner/repo for LightTrack telemetry (below) — the per-repo dimension of the LLM-cost rollup.
  const repoFullName = `${parsed.owner}/${parsed.repo}`;
  const attemptAssess = async (p: LLMProvider, attemptSignal: AbortSignal | undefined) => {
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
      if (p.name !== "mock" && !isAssessmentUsable(a, signals.length)) {
        throw new Error(
          `LLM returned an unusable assessment (${a.dimensions.length}/${signals.length} dimensions scored).`,
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
          repo: repoFullName,
          org: opts.orgSlug,
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
          repo: repoFullName,
          org: opts.orgSlug,
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
  let assessment: Awaited<ReturnType<LLMProvider["assess"]>>;
  let usedProvider: LLMProvider = provider;
  // Scan-wide LLM deadline. Each attempt enforces its own per-call timeout (LLM_TIMEOUT_MS), but the
  // resilience plan (primary + retry + failover) MULTIPLIES them — three ~60s attempts can burn ~181s
  // and blow the serverless function timeout BEFORE the mock degrade ever runs, so the user gets a 500
  // instead of the deterministic floor. Cap the TOTAL time across attempts: when the budget expires the
  // in-flight call and every remaining attempt abort, and we fall through to mock — well under the
  // platform limit. The budget signal is distinct from the client's `signal` so a budget expiry
  // degrades to mock while a real client disconnect still unwinds the whole scan.
  const llmDeadline = new AbortController();
  const llmDeadlineTimer = setTimeout(
    () => llmDeadline.abort(new Error("LLM total budget exceeded")),
    llmTotalBudgetMs(intendedProvider),
  );
  const llmSignal = signal ? AbortSignal.any([signal, llmDeadline.signal]) : llmDeadline.signal;
  try {
    // BYOM scans never fall over to the PLATFORM provider (that would send the org's data to Ascent's
    // account, defeating the privacy guarantee) — they retry the org's Bedrock, then degrade to mock.
    const fallback =
      intendedProvider === "mock" || byomScan ? null : providerByName(process.env.LLM_FALLBACK_PROVIDER);
    const plan: { p: LLMProvider; note?: string }[] = [{ p: provider }];
    if (intendedProvider !== "mock") plan.push({ p: provider, note: `Retrying ${intendedProvider}…` });
    if (fallback && fallback.name !== intendedProvider)
      plan.push({ p: fallback, note: `Falling over to ${fallback.name}…` });

    let resolved: Awaited<ReturnType<LLMProvider["assess"]>> | null = null;
    let lastErr: unknown;
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]!; // safe: i bounded by plan.length
      try {
        if (i > 0) {
          if (llmDeadline.signal.aborted) break; // budget spent — don't sleep before a doomed retry
          await sleep(LLM_RETRY_MS);
          signal?.throwIfAborted();
          emit({ stage: "score", message: step.note ?? "Retrying…", pct: 80, provider: step.p.name });
        }
        resolved = await attemptAssess(step.p, llmSignal);
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
          message: "Model unavailable — showing deterministic scores.",
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
  provider = usedProvider;
  const llmLatencyMs = Date.now() - llmStartedAt;

  // The mock fallback (and any provider that ignores the signal) can resolve even after a
  // disconnect — re-check before composing/persisting so we don't do that work for no one.
  signal?.throwIfAborted();
  emit({ stage: "compose", message: "Composing your report…", pct: 95 });
  const report = assembleReport(snapshot, signals, assessment, provider, now, archetype);
  report.prStats = prStats;
  // Re-derive AI usage now that PR stats are available: `detected` keys on REAL AI evidence (PR-level
  // AI involvement with tool attribution, committed guidance, or genuine AI co-author trailers) rather
  // than the bot-commit fraction that spuriously counted Renovate/Dependabot as "AI" (reference-scan P0-5).
  report.aiUsage = detectAiUsage(snapshot, prStats);
  report.governance = governance;
  report.commitActivity = await activityPromise;
  // Team attribution from CODEOWNERS (the file is already in the snapshot — no extra GitHub call).
  // Display + persist only; it doesn't move the score. Empty array = no CODEOWNERS teams found.
  report.teams = extractTeamOwnership(snapshot.files);
  // Tech-stack detection (Feature 3a): computed once above. Always attached for display/persistence
  // (the prompt enrichment is the separate, gated Option-B path).
  report.techStack = techStack;
  // App Readiness Passport: a pure projection of the finished report + snapshot — display/persist-only
  // (never scored, like techStack). report.governance/prStats are already set above; a tokenless scan
  // leaves them null, which makes buildPassport honestly cap the enforced "gated" rungs. See passport.ts.
  report.passport = buildPassport(report, snapshot);
  // Token usage (from the provider that scored) + LLM-stage latency — the cost/usage metering basis,
  // persisted on the Scan row. A mock/keyless scan carries no tokens (cost 0), just the latency.
  report.usage = { ...capturedUsage, latencyMs: llmLatencyMs };

  // Eval-log capture (opt-in via ASCENT_EVAL_LOG_DIR — Tiger P1-4): record the prompt + structured
  // assessment + provenance + metering so a usable-but-wrong answer is debuggable, an injection is
  // traceable, and the model×tier benchmark has a corpus. Only build the prompt when logging is on;
  // best-effort, never blocks the scan.
  if (evalLogEnabled()) {
    const { system, user } = buildAssessmentPrompt(scoreInput);
    captureAssessment({
      at: now,
      repo: `${parsed.owner}/${parsed.repo}`,
      provider: provider.name,
      model: provider.model,
      degraded: llmFailed,
      coverage: { scored: assessment.dimensions.length, expected: signals.length },
      latencyMs: llmLatencyMs,
      usage: report.usage,
      system,
      user,
      assessment,
    });
  }

  // Surface non-fatal reliability caveats so the score is interpreted in context.
  const warnings: string[] = [...detectorWarnings];
  if (!token) {
    warnings.push(
      "Pull-request signals were skipped — they need a GitHub token (GraphQL has no anonymous access).",
    );
  }
  if (llmFailed) {
    warnings.push(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
  } else if (provider.name === "mock" && !opts.mock) {
    // Keyless / unconfigured deploy: the engine fell back to the deterministic mock from the START —
    // NOT a runtime failure (llmFailed is false, so the caveat above never fires) and NOT an explicit
    // per-request demo (opts.mock). Without this, a keyless public deploy serves the floor as an "AI"
    // scan disclosed only by a quiet engine chip. Say it plainly so a public-badge or audit reader
    // knows the AI layer never ran, instead of inferring it. [Tiger P1-5 / MEI-B1]
    warnings.push(
      "No AI model is configured for this scan, so scores reflect detected signals only (the deterministic rubric — no AI nuance).",
    );
  }
  if (snapshot.truncated) {
    warnings.push(
      "This repository is very large — its file tree was truncated, so some signals may be missed.",
    );
  } else if (snapshot.coverage < 0.5) {
    warnings.push(
      `Only part of the repository could be inspected (~${Math.round(snapshot.coverage * 100)}% coverage); treat scores as indicative.`,
    );
  }
  // Partial-fit caveat: name a stack the web/service-tuned rubric is known to under-read (ML/notebooks,
  // mobile delivery, embedded/firmware) so the score is read honestly rather than taken at face value.
  // Detected once above and also threaded into the LLM prompt (Tiger P0-2) — reuse it here.
  if (stackFit) warnings.push(stackFit.caveat);
  // A truncated PR slice makes D6/D7/D8 understate. Say so on the report (the UI, the LLM export and the
  // CI gate all read `warnings`), and stamp the typed flag classifyScanResult uses to refuse caching or
  // persisting this report as authoritative.
  if (prPartial) {
    report.prPartial = true;
    warnings.push(
      "Pull-request data was incomplete (GitHub returned a truncated page), so the Review, Velocity and Delivery dimensions may understate. This scan was not cached.",
    );
  }
  if (warnings.length) report.warnings = [...(report.warnings ?? []), ...warnings];

  emit({ stage: "done", message: "Done", pct: 100 });
  return report;
}

export { GitHubError } from "@/lib/github/source";
