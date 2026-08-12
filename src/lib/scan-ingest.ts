// Scan phase: ingestion. Fetch the repo snapshot and every GitHub-side enrichment the scoring leg
// needs, overlapping the calls that can overlap.
//
// Extracted verbatim from scanRepository (src/lib/scan.ts). Everything here is I/O against GitHub;
// nothing downstream of it is. The one semantic that must not drift: `headSha` pins ingestion to the
// exact COMMIT the cache key was built from and is then stamped onto the snapshot as the report's
// canonical commit identity (fetchSnapshot otherwise records the TREE object's sha). An explicit
// PR `ref` always wins over it.

import { fetchGuidanceFreshness, type ParsedRepo, type ProgressFn, type RepoSource } from "@/lib/github/source";
import { fetchPrStats, type AiChangeRecord } from "@/lib/analyze/pulls";
import { pickGuidanceFiles } from "@/lib/analyze/context-health";
import { fetchBranchGovernance, fetchCommitActivity } from "@/lib/github/governance";
import { fetchSecurityPosture } from "@/lib/github/security-posture";
import { fetchSecurityExposure } from "@/lib/security/exposure";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { Governance, GuidanceFreshness, PrStats, RepoSnapshot, SecurityExposure, SecurityPosture } from "@/lib/types";

export interface IngestPhaseInput {
  parsed: ParsedRepo;
  source: RepoSource;
  /** Resolved GitHub token (already ambient-guarded upstream). Absent ⇒ every enrichment is skipped. */
  token?: string;
  /** Explicit git ref (PR gating). Wins over `headSha`. */
  ref?: string;
  /** Commit sha already resolved for the cache key — pins ingestion AND stamps the report identity. */
  headSha?: string;
  /**
   * Monorepo sub-tree to aim the per-file CONTENT budget at (G7-08). Validated/normalized upstream by
   * `normalizeSubPath` (src/lib/scan-scope.ts) before it reaches any URL builder. Affects only which
   * file CONTENTS are sampled — the tree, the commit history and every repo-level enrichment below
   * (PR stats, governance, security posture/exposure) remain repo-wide facts and are untouched.
   */
  subPath?: string;
  signal?: AbortSignal;
  emit: ProgressFn;
}

export interface IngestPhaseResult {
  snapshot: RepoSnapshot;
  prStats: PrStats | null;
  /** The PR page came back truncated — the scan must not be cached/persisted as authoritative. */
  prPartial: boolean;
  governance: Governance | null;
  securityPosture: SecurityPosture | null;
  securityExposure: SecurityExposure | null;
  /** Display-only; still in flight. Awaited at compose time so it overlaps the LLM call. */
  activityPromise: Promise<number[] | null>;
  /** Context Health (W4): per-guidance-file last-modified lookups (≤3 REST calls, keyless-safe,
   *  degrade-don't-fail). Display-only; still in flight, awaited at compose time like activity. */
  guidanceFreshnessPromise: Promise<GuidanceFreshness[]>;
  /** AI-attributed PRs as durable evidence rows; empty when scanning without a token. */
  aiChanges: AiChangeRecord[];
}

/**
 * Fetch the snapshot plus the score-bearing enrichments (PR stats, governance, security posture and
 * exposure), and hand back the display-only commit-activity promise still unresolved so it keeps
 * overlapping the LLM stage. Emits the "analyze" progress frame. Throws whatever fetchSnapshot throws
 * (GitHubError) and re-checks the abort signal at the stage boundary.
 */
export async function ingestRepository(input: IngestPhaseInput): Promise<IngestPhaseResult> {
  const { parsed, source, token, signal, emit } = input;

  // Pull-request ingestion (GraphQL) runs in parallel with the REST snapshot fetch, then is
  // awaited before analysis so PR signals fold into the dimension scores (F4). GraphQL needs a
  // token — skip gracefully (null) when scanning anonymously.
  const prPromise: Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] } | null> = token
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
  const pinnedRef = input.ref ?? input.headSha;
  const snapshot = await source.fetchSnapshot(parsed, {
    token,
    onProgress: emit,
    signal,
    ref: pinnedRef,
    subPath: input.subPath,
  });
  if (!input.ref && input.headSha) snapshot.meta.headSha = input.headSha;
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
  // Context Health (W4): last-modified per detected guidance file. Deliberately NOT token-gated —
  // the /commits?path= endpoint answers anonymously within rate limits — and pinned to the commit
  // actually scored (else the read ref) so the freshness matches the snapshot. Bounded to ≤3 calls;
  // any failure degrades per-file to "freshness unknown" instead of failing the scan.
  const guidancePaths = pickGuidanceFiles(snapshot.tree).map((f) => f.path);
  const guidanceFreshnessPromise: Promise<GuidanceFreshness[]> = guidancePaths.length
    ? fetchGuidanceFreshness(
        parsed,
        snapshot.meta.headSha ?? pinnedRef ?? snapshot.meta.defaultBranch,
        guidancePaths,
        { token, signal },
      ).catch(() => guidancePaths.map((path) => ({ path })))
    : Promise.resolve([]);

  emit({ stage: "analyze", message: `Analyzing signals across ${DIMENSIONS.length} dimensions…`, pct: 62 });
  const [prResult, governance, securityPosture, securityExposure] = await Promise.all([prPromise, govPromise, secPromise, expPromise]);

  return {
    snapshot,
    prStats: prResult?.stats ?? null,
    // graphql.ts sets `partial` when the PR page came back truncated (null nodes / an `errors` array on a
    // 200). Such results must not be treated as authoritative or cached — so `prPartial` IS consumed by
    // the caller (the poisoning guard): it appends a reliability warning and stamps the typed
    // `report.prPartial` flag classifyScanResult reads to refuse caching/persisting this scan as
    // authoritative — instead of a truncated slice silently deflating D6/D7/D8 on large or
    // rate-limited repos.
    prPartial: prResult?.partial ?? false,
    // The AI-attributed PRs as EVIDENCE ROWS (the population behind aiInvolvedRate/aiGovernedRate),
    // extracted from the same fetched nodes. Empty on an anonymous scan — GraphQL needs a token — and
    // that emptiness means "not observable here", never "this repo has no AI changes".
    aiChanges: prResult?.aiChanges ?? [],
    governance,
    securityPosture,
    securityExposure,
    activityPromise,
    guidanceFreshnessPromise,
  };
}
