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
import { getProvider, MockProvider } from "@/lib/llm";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { isAssessmentUsable } from "@/lib/llm/provider";
import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { assembleReport } from "@/lib/scoring/engine";
import type { Governance, PrStats, ScanReport } from "@/lib/types";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db";

export interface ScanOptions {
  token?: string;
  mock?: boolean;
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
  const id = installationId ?? (await getInstallationIdForOwner(parsed.owner)) ?? undefined;
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
  const token = opts.token ?? process.env.GITHUB_TOKEN;
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

  emit({ stage: "analyze", message: "Analyzing signals across 7 dimensions…", pct: 62 });
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
  let assessment;
  try {
    assessment = await provider.assess(scoreInput, { signal });
    // Quality gate: validateAssessment() never throws, so a parseable-but-empty reply
    // ({}, wrong shape, or all-unknown dimension ids) coerces to an assessment scoring
    // (almost) no dimensions. Left unchecked it would render the deterministic floor
    // under the provider's name with no caveat. Treat it exactly like a thrown failure.
    if (intendedProvider !== "mock" && !isAssessmentUsable(assessment, signals.length)) {
      throw new Error(
        `LLM returned an unusable assessment (${assessment.dimensions.length}/${signals.length} dimensions scored).`,
      );
    }
  } catch (err) {
    // Client disconnected mid-call — don't spend a mock fallback + compose pass on a report
    // nobody will receive. Propagate the abort so the whole scan unwinds.
    if (signal?.aborted) throw err;
    // LLM failed (key invalid, quota, timeout, or an empty/unusable response) — degrade
    // gracefully to deterministic. Only flag it when the LLM was actually expected (not
    // an intentional/keyless mock).
    llmFailed = intendedProvider !== "mock";
    if (llmFailed) {
      console.error("[scan] LLM provider failed, falling back to mock:", err);
      // Tell the UI the model didn't make it so it can fade in a calm "showing deterministic
      // scores" note, rather than leaving the provider-specific "Asking …" copy hanging until
      // the report (with its "AI was unavailable" warning) finally lands.
      emit({
        stage: "score",
        message: "Model took too long — showing deterministic scores.",
        pct: 90,
        fallback: true,
      });
    }
    provider = new MockProvider();
    assessment = await provider.assess(scoreInput);
  }

  // The mock fallback (and any provider that ignores the signal) can resolve even after a
  // disconnect — re-check before composing/persisting so we don't do that work for no one.
  signal?.throwIfAborted();
  emit({ stage: "compose", message: "Composing your report…", pct: 95 });
  const report = assembleReport(snapshot, signals, assessment, provider, now, archetype);
  report.prStats = prStats;
  report.governance = governance;
  report.commitActivity = await activityPromise;

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
