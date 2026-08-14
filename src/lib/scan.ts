// Top-level scan orchestrator: URL -> ingest -> deterministic signals -> LLM assess
// -> assembled report. Emits progress at each stage (for SSE) and falls back to the
// MockProvider if the LLM call fails OR returns an empty/unusable assessment, so a scan
// always returns a usable report and flags when the AI layer didn't really contribute.
//
// Each leg lives in its own phase module so it is readable and testable on its own; this file is the
// sequencing + the cross-phase wiring only:
//   • scan-ingest.ts       — GitHub I/O: snapshot + PR/governance/security/activity enrichment.
//   • scan-score-input.ts  — deterministic signals → the LlmScoreInput the model sees.
//   • scan-assess.ts       — the LLM call with its retry / failover / budget / mock-degrade policy.
//   • scan-compose.ts      — report assembly, eval-log capture, and the reliability caveats.

import {
  GitHubError,
  GitHubPublicSource,
  parseRepoUrl,
  type ParsedRepo,
  type ProgressFn,
  type RepoSource,
} from "@/lib/github/source";
import { getProviderForOrg } from "@/lib/llm";
import { BedrockProvider } from "@/lib/llm/bedrock";
import type { LLMProvider } from "@/lib/llm/provider";
import { matrixCaptureEnabled, captureMatrixInput } from "@/lib/llm/matrix-capture";
import { evalLogEnabled } from "@/lib/llm/eval-log";
import type { ScanReport } from "@/lib/types";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db";
import { canMintInstallationToken } from "@/lib/authz";
import { ingestRepository } from "@/lib/scan-ingest";
import { buildScanScoreInput } from "@/lib/scan-score-input";
import { runAssessmentPhase } from "@/lib/scan-assess";
import { buildScanWarnings, captureScanEvalLog, composeScanReport } from "@/lib/scan-compose";
import { classifyOutputBudget } from "@/lib/llm/output-budget";
import { recordScanDegraded, recordScanFailure, recordScanStarted } from "@/lib/scan-outcome";

// The LLM failure classifiers live with the resilience loop that consumes them; re-exported here so
// `@/lib/scan` remains the single import surface for the scan pipeline.
export { isHardLlmError, shouldRetrySameProvider } from "@/lib/scan-assess";

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
   * Monorepo sub-tree to aim the per-file ingestion budget at, e.g. `packages/api` (G7-08). Must be
   * normalized through `normalizeSubPath` (src/lib/scan-scope.ts) by the caller. Repo-wide files
   * (root manifests, CODEOWNERS, SECURITY.md, every CI workflow) are still ingested — only the
   * docs/test/source SAMPLE slots are scoped — and every GitHub-side enrichment stays repo-level.
   *
   * SCORE COMPARABILITY: a sub-path scan reads a different file set, so it is NOT comparable with a
   * whole-repo score. Callers must treat the resulting report as scoped (see `isScopedScan`): never
   * persisted to the shared corpus, and stamped with the `scopeWarning` caveat.
   */
  subPath?: string;
  /**
   * Prose caveat to append to `report.warnings` when this scan is SCOPED (a non-default ref and/or a
   * sub-path). Built by the calling route via `scopeWarning` (src/lib/scan-scope.ts), because only the
   * route knows the repo's default-branch head sha and can therefore tell a genuinely scoped scan from
   * a ref that merely points at the default head. Omitted ⇒ no scope caveat (the PR-gate and webhook
   * paths, unchanged).
   */
  scopeCaveat?: string | null;
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

/** Public entry point. Wraps the pipeline in outcome tallies (src/lib/scan-outcome.ts): a failed scan
 *  writes no Scan row, so without these counters a pipeline failure is invisible. The counters are
 *  best-effort and the error is always re-thrown unchanged — behavior for every caller is identical. */
export async function scanRepository(input: string, opts: ScanOptions = {}): Promise<ScanReport> {
  await recordScanStarted();
  try {
    return await runScanRepository(input, opts);
  } catch (err) {
    await recordScanFailure(err);
    throw err;
  }
}

async function runScanRepository(input: string, opts: ScanOptions = {}): Promise<ScanReport> {
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
  // fallback in the assess phase so a BYOM failure degrades to mock only (privacy-strict, §8.2) —
  // never the platform.
  const providerSelection = await getProviderForOrg(opts.orgSlug, { forceMock: opts.mock });
  const selectedProvider: LLMProvider = providerSelection.provider;
  const byomScan = providerSelection.byom;
  const intendedProvider = selectedProvider.name;
  const providerRegion = selectedProvider instanceof BedrockProvider ? selectedProvider.region : undefined;

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

  // ── Phase 1: ingest ───────────────────────────────────────────────────────────────────────────
  const { snapshot, prStats, prPartial, governance, securityPosture, securityExposure, activityPromise, guidanceFreshnessPromise, aiChanges, deployments } =
    await ingestRepository({
      parsed,
      source,
      token,
      ref: opts.ref,
      headSha: opts.headSha,
      subPath: opts.subPath,
      signal,
      emit,
    });

  // Resolve the scan timestamp up front and thread it through signal extraction, so D7's
  // recency bonus is deterministic (and the same `now` stamps the report below).
  const now = opts.now ?? new Date().toISOString();
  // owner/repo — the LightTrack telemetry dimension and the eval-log / matrix-capture repo key.
  const repoFullName = `${parsed.owner}/${parsed.repo}`;

  // ── Phase 2: deterministic signals → the model's input ────────────────────────────────────────
  const { signals, archetype, stackFit, techStack, scoreInput, detectorWarnings } = await buildScanScoreInput({
    snapshot,
    prStats,
    governance,
    securityPosture,
    securityExposure,
    now,
    // decisionOrgSlug (individual tier) points the standing-decision read at the TRIGGERING viewer's
    // personal org on the public funnel; org scans keep reading their own org via the orgSlug fallback.
    decisionSlug: opts.decisionOrgSlug ?? opts.orgSlug,
  });

  // Model-matrix capture (dev/bench only, gated on ASCENT_MATRIX_CAPTURE_DIR): dump the fully-built
  // {scoreInput, snapshot} so the model-comparison bench can replay assess() across models on identical
  // inputs. Best-effort, no-op in production. Runs BEFORE assess() so a capture scan can force the mock
  // provider (no LLM key needed) and still record a real input.
  if (matrixCaptureEnabled()) {
    captureMatrixInput({ repo: repoFullName, at: now, scoreInput, snapshot });
  }

  // ── Phase 3: LLM assessment (retry → failover → deterministic mock floor) ─────────────────────
  const {
    assessment,
    provider,
    llmFailed,
    usage,
    latencyMs: llmLatencyMs,
  } = await runAssessmentPhase({
    provider: selectedProvider,
    intendedProvider,
    byomScan,
    scoreInput,
    expectedDimensions: signals.length,
    repoFullName,
    orgSlug: opts.orgSlug,
    signal,
    emit,
  });

  // The mock floor is a SILENT failure: a report still renders, so it counts as a success everywhere
  // else even though the model never ran. Tallied separately from the error rate, which is defined
  // over scans that terminated.
  if (llmFailed) void recordScanDegraded(intendedProvider);

  // ── Phase 4: compose ─────────────────────────────────────────────────────────────────────────
  // The mock fallback (and any provider that ignores the signal) can resolve even after a
  // disconnect — re-check before composing/persisting so we don't do that work for no one.
  signal?.throwIfAborted();
  emit({ stage: "compose", message: "Composing your report…", pct: 95 });
  const report = await composeScanReport({
    snapshot,
    signals,
    assessment,
    provider,
    now,
    archetype,
    byomScan,
    prStats,
    governance,
    aiChanges,
    deployments,
    activityPromise,
    guidanceFreshnessPromise,
    techStack,
    usage,
    llmLatencyMs,
  });

  // Eval-log capture (opt-in via ASCENT_EVAL_LOG_DIR — Tiger P1-4). Only build the prompt when
  // logging is on; best-effort, never blocks the scan.
  if (evalLogEnabled()) {
    captureScanEvalLog({
      now,
      repoFullName,
      provider,
      llmFailed,
      assessment,
      expectedDimensions: signals.length,
      llmLatencyMs,
      usage: report.usage,
      scoreInput,
    });
  }

  // A truncated PR slice makes D6/D7/D8 understate — stamp the typed flag classifyScanResult uses to
  // refuse caching or persisting this report as authoritative (the matching prose caveat comes from
  // buildScanWarnings below).
  if (prPartial) report.prPartial = true;
  // Surface non-fatal reliability caveats so the score is interpreted in context.
  const warnings = buildScanWarnings({
    detectorWarnings,
    hasToken: Boolean(token),
    llmFailed,
    providerName: provider.name,
    explicitMock: Boolean(opts.mock),
    snapshotTruncated: snapshot.truncated,
    snapshotCoverage: snapshot.coverage,
    stackFit,
    prPartial,
    // The god-scan indicator: how much of the model's output ceiling this single assessment call
    // used. Measured from the usage the winning provider reported, against that provider's model.
    outputBudget: classifyOutputBudget(report.usage?.outputTokens, report.engine?.model),
    // A ref/sub-path scan reports on a different SUBJECT than "this repository" — say so on the report
    // itself, not only in the route that suppressed its persistence. Supplied by the caller rather than
    // derived here: only the ROUTE knows the default branch's head sha, so only it can tell a genuinely
    // scoped scan from a ref that happens to point at the default head (see isScopedScan). Unset for the
    // PR-gate/webhook paths, which are byte-for-byte unchanged.
    scopeCaveat: opts.scopeCaveat ?? null,
  });
  if (warnings.length) report.warnings = [...(report.warnings ?? []), ...warnings];

  emit({ stage: "done", message: "Done", pct: 100 });
  return report;
}

export { GitHubError } from "@/lib/github/source";
