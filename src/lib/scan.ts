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
import { analyzeSignals, classifyArchetype } from "@/lib/analyze";
import { applyGovernanceSignals, applyPrSignals, fetchPrStats } from "@/lib/analyze/pulls";
import { fetchBranchGovernance, fetchCommitActivity } from "@/lib/github/governance";
import { getProvider, providerByName, MockProvider } from "@/lib/llm";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { isAssessmentUsable } from "@/lib/llm/provider";
import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { assembleReport } from "@/lib/scoring/engine";
import { DIMENSIONS } from "@/lib/maturity/model";
import { extractTeamOwnership } from "@/lib/github/codeowners";
import type { Governance, PrStats, ScanReport, TokenUsage } from "@/lib/types";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { sessionHasInstallation, sessionOwnsOrg } from "@/lib/authz";

/** Backoff before a single LLM retry — fixed (no jitter) to keep the scan path deterministic-friendly. */
const LLM_RETRY_MS = 500;
/** Total wall-clock budget for ALL LLM attempts (primary + retry + failover) in one scan. Sits under
 *  the route's maxDuration (120s) so the mock degrade is always reached before the platform hard-kills
 *  the function. Overridable via env for slower self-hosted models. */
const LLM_TOTAL_BUDGET_MS = Number(process.env.LLM_TOTAL_BUDGET_MS) || 90_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ScanOptions {
  token?: string;
  mock?: boolean;
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
): Promise<{ token?: string; orgSlug: string }> {
  if (!parsed || !isAppConfigured()) return { orgSlug: "public" };
  // AUTHORIZE before minting. Without this, an anonymous caller could pass another tenant's
  // (enumerable) installationId — or simply rely on the repo owner's stored installation — to mint
  // that installation's token and read a PRIVATE repo's maturity (cross-tenant IDOR). Mirror the
  // org-import gate: when auth is configured, a caller-supplied id must belong to their session, and
  // the owner's stored installation is used only for a caller who owns that org; auth-off (local/
  // demo) stays open, exactly like requireOrgAccess.
  const authOn = isAuthConfigured();
  let id: string | undefined;
  if (installationId) {
    if (!authOn || (await sessionHasInstallation(installationId))) id = installationId;
  }
  if (!id && (!authOn || (await sessionOwnsOrg(parsed.owner)))) {
    id = (await getInstallationIdForOwner(parsed.owner)) ?? undefined;
  }
  if (!id) return { orgSlug: "public" };
  try {
    return { token: await getInstallationToken(id), orgSlug: parsed.owner.toLowerCase() };
  } catch {
    return { orgSlug: "public" };
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
  let provider: LLMProvider = getProvider({ forceMock: opts.mock });
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
  const prPromise: Promise<PrStats | null> = token
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
  const activityPromise: Promise<number[] | null> = token
    ? fetchCommitActivity(parsed.owner, parsed.repo, token, signal).catch(() => null)
    : Promise.resolve(null);

  emit({ stage: "analyze", message: `Analyzing signals across ${DIMENSIONS.length} dimensions…`, pct: 62 });
  const [prStats, governance] = await Promise.all([prPromise, govPromise]);
  // Resolve the scan timestamp up front and thread it through signal extraction, so D7's
  // recency bonus is deterministic (and the same `now` stamps the report below).
  const now = opts.now ?? new Date().toISOString();
  const detectorWarnings: string[] = [];
  const signals = applyGovernanceSignals(
    applyPrSignals(analyzeSignals(snapshot, now, detectorWarnings), prStats),
    governance,
  );
  const archetype = classifyArchetype(snapshot);

  const scoreInput: LlmScoreInput = {
    repo: snapshot.meta,
    signals,
    files: snapshot.files,
    commitSample: snapshot.commits.map((c) => c.message).slice(0, 15),
    archetype,
    // Already fetched above and folded into the deterministic D3/D6/D7/D8 scores — also hand them to
    // the LLM auditor so it reasons about review/governance with the real evidence (MAT-1).
    prStats,
    governance,
  };

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
  const attemptAssess = async (p: LLMProvider, attemptSignal: AbortSignal | undefined) => {
    // Capture this attempt's usage into a LOCAL and commit it to capturedUsage only AFTER the
    // attempt is proven usable. Providers call onUsage BEFORE the parse/usability check, so a failed
    // attempt (malformed JSON, unusable coverage) would otherwise leave its tokens on report.usage
    // even though the scan degraded to mock — billing the user for an attempt that never contributed.
    let attemptUsage: TokenUsage = {};
    const a = await p.assess(scoreInput, { signal: attemptSignal, onUsage: (u) => { attemptUsage = u; } });
    if (p.name !== "mock" && !isAssessmentUsable(a, signals.length)) {
      throw new Error(
        `LLM returned an unusable assessment (${a.dimensions.length}/${signals.length} dimensions scored).`,
      );
    }
    capturedUsage = attemptUsage; // commit only on success
    return a;
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
    LLM_TOTAL_BUDGET_MS,
  );
  const llmSignal = signal ? AbortSignal.any([signal, llmDeadline.signal]) : llmDeadline.signal;
  try {
    const fallback =
      intendedProvider === "mock" ? null : providerByName(process.env.LLM_FALLBACK_PROVIDER);
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
  report.governance = governance;
  report.commitActivity = await activityPromise;
  // Team attribution from CODEOWNERS (the file is already in the snapshot — no extra GitHub call).
  // Display + persist only; it doesn't move the score. Empty array = no CODEOWNERS teams found.
  report.teams = extractTeamOwnership(snapshot.files);
  // Token usage (from the provider that scored) + LLM-stage latency — the cost/usage metering basis,
  // persisted on the Scan row. A mock/keyless scan carries no tokens (cost 0), just the latency.
  report.usage = { ...capturedUsage, latencyMs: llmLatencyMs };

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
  if (warnings.length) report.warnings = [...(report.warnings ?? []), ...warnings];

  emit({ stage: "done", message: "Done", pct: 100 });
  return report;
}

export { GitHubError } from "@/lib/github/source";
