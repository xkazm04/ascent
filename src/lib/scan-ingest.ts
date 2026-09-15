// Scan phase: ingestion. Fetch the repo snapshot and every GitHub-side enrichment the scoring leg
// needs, overlapping the calls that can overlap.
//
// Extracted verbatim from scanRepository (src/lib/scan.ts). Everything here is I/O against GitHub;
// nothing downstream of it is. The one semantic that must not drift: `headSha` pins ingestion to the
// exact COMMIT the cache key was built from and is then stamped onto the snapshot as the report's
// canonical commit identity (fetchSnapshot otherwise records the TREE object's sha). An explicit
// PR `ref` always wins over it.

import type { ParsedRepo, ProgressFn, RepoSource } from "@/lib/github/source";
import type { AiChangeRecord } from "@/lib/analyze/pulls";
import { pickGuidanceFiles } from "@/lib/analyze/context-health";
import type { DeploymentRecord } from "@/lib/github/deployments";
import type { AppInventory } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";
import { resolveForge } from "@/lib/forge/registry";
import type { EnrichmentSource, Forge } from "@/lib/forge/types";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { Governance, GuidanceFreshness, PrStats, RepoSnapshot, ScanSensorId, SecurityExposure, SecurityPosture } from "@/lib/types";

export interface IngestPhaseInput {
  parsed: ParsedRepo;
  source: RepoSource;
  /**
   * The forge whose enrichment set answers the platform reads below (moonshot #4). Omitted ⇒ GitHub,
   * which is what every caller meant before the seam existed — `resolveForge()` with no argument
   * returns the GitHub adapter, whose members are REFERENCE-EQUAL to the functions this file used to
   * import directly (asserted by `src/lib/forge/github-parity.test.ts`). So an omitted `forge` is not
   * a fallback path; it is the same code, reached through one indirection.
   */
  forge?: Forge;
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
  /** A token was present but PR ingestion THREW — the sensor failed. Distinguishable from the
   *  anonymous skip (no token) and from a genuinely PR-less repo: prStats:null alone conflates all
   *  three, and a failed sensor must not persist as "repo has no PRs". */
  prFetchFailed: boolean;
  governance: Governance | null;
  /** W4 — recent deployments with their latest status. Empty on an anonymous scan, or on a repo that
   *  doesn't use GitHub Deployments; emptiness means "not observable here", never "never deployed".
   *  When the READ itself failed, the empty list is accompanied by `deployments` in `sensorFailures`,
   *  which is what tells the two emptinesses apart. */
  deployments: DeploymentRecord[];
  securityPosture: SecurityPosture | null;
  securityExposure: SecurityExposure | null;
  /** Deepening pass: GitHub Apps that posted check suites on the scored commit (Settings-configured
   *  tooling a file scan can't see). Null = not observable (anonymous scan / read failed). */
  appInventory: AppInventory | null;
  /** Deepening pass: recent default-branch Actions run health. Null = not observable. */
  ciHealth: CiHealth | null;
  /** Display-only; still in flight. Awaited at compose time so it overlaps the LLM call. */
  activityPromise: Promise<number[] | null>;
  /** Context Health (W4): per-guidance-file last-modified lookups (≤3 REST calls, keyless-safe,
   *  degrade-don't-fail). Display-only; still in flight, awaited at compose time like activity. */
  guidanceFreshnessPromise: Promise<GuidanceFreshness[]>;
  /** AI-attributed PRs as durable evidence rows; empty when scanning without a token. */
  aiChanges: AiChangeRecord[];
  /**
   * The sensors whose read THREW — the general form of `prFetchFailed`, which stays separate because
   * it already has its own typed flag and its own caveat.
   *
   * Every enrichment below swallows its failure into the SAME value a successful-but-empty read
   * produces (`null` / `[]`), and downstream that value is scored as absence: a null posture makes
   * `securityPolicy()` report "No security policy (SECURITY.md) found" with a remediation for a
   * control the org may well have, and a null App inventory floors SAST and dependency-updates at 0
   * although the inventory's own contract says null NEVER means "no Apps installed". Recording WHICH
   * read failed is what lets the D9 battery exclude those checks and `buildScanWarnings` say it out
   * loud. Ordered by SENSOR_ORDER (stable), never by which promise rejected first.
   */
  sensorFailures: ScanSensorId[];
}

/** Canonical report order for the sensors — so the warning text is stable across runs. */
const SENSOR_ORDER: readonly ScanSensorId[] = [
  "governance",
  "securityPosture",
  "securityExposure",
  "appInventory",
  "ciHealth",
  "deployments",
];

/**
 * Fetch the snapshot plus the score-bearing enrichments (PR stats, governance, security posture and
 * exposure), and hand back the display-only commit-activity promise still unresolved so it keeps
 * overlapping the LLM stage. Emits the "analyze" progress frame. Throws whatever fetchSnapshot throws
 * (GitHubError) and re-checks the abort signal at the stage boundary.
 */
export async function ingestRepository(input: IngestPhaseInput): Promise<IngestPhaseResult> {
  const { parsed, source, token, signal, emit } = input;
  // THE ROUTING (moonshot #4). Every enrichment below reads its function off this record instead of
  // importing it, and an ABSENT member means "this forge cannot be asked" — which falls through to
  // exactly the value the token-less branch already produced (`null` / `[]`), never to a zero. That
  // equivalence is the whole honest-nulls argument: a forge with fewer observables FLOORS a score
  // through paths the rubric already had, instead of being scored against a different rubric.
  const enrich: EnrichmentSource = (input.forge ?? resolveForge()).enrich?.() ?? {};

  // Pull-request ingestion (GraphQL) runs in parallel with the REST snapshot fetch, then is
  // awaited before analysis so PR signals fold into the dimension scores (F4). GraphQL needs a
  // token — skip gracefully (null) when scanning anonymously.
  let prFetchFailed = false;
  // ONE recorder for every sensor below, so a new enrichment cannot be added with a silent
  // `.catch(() => null)`. It returns the same degraded value the catch already returned — the shape of
  // the pipeline is unchanged — and only ADDS the fact that the read failed.
  const failedSensors = new Set<ScanSensorId>();
  const sensorFailed = <T>(id: ScanSensorId, degraded: T) => (err: unknown): T => {
    console.error(`[scan] ${id} read failed:`, err);
    failedSensors.add(id);
    return degraded;
  };
  const prPromise: Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] } | null> = token && enrich.pullRequests
    ? enrich.pullRequests(parsed.owner, parsed.repo, token, signal).catch((err) => {
        // The sensor failed — record the fact so it persists with the scan (a caveat via
        // buildScanWarnings), instead of degrading to a null indistinguishable from "no PRs".
        console.error("[scan] PR ingestion failed:", err);
        prFetchFailed = true;
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
  const govPromise: Promise<Governance | null> = token && enrich.branchGovernance
    ? enrich.branchGovernance(parsed.owner, parsed.repo, snapshot.meta.defaultBranch, token, signal).catch(sensorFailed("governance", null))
    : Promise.resolve(null);
  // GitHub-native security posture (published advisories + org-level security policy) — fed to the
  // Security (D9) check battery below (the Security-Policy check). Public reads, token-gated.
  const secPromise: Promise<SecurityPosture | null> = token && enrich.securityPosture
    ? enrich.securityPosture(parsed.owner, parsed.repo, token, signal).catch(sensorFailed("securityPosture", null))
    : Promise.resolve(null);
  // Current EXPOSURE — open known vulns from OSV (parsed from the committed npm lockfile). The
  // "open vulns are the real negative" axis, kept separate from posture; degrades to UNKNOWN.
  // #4 — routed like the rest. The OSV read is GitHub-CONTENT-bound (it reads the committed lockfile
  // over GitHub's API), so it is a capability, not a universal: a GitLab scan gets `null` here, which
  // `SecurityExposure`'s own contract already defines as "we could not inspect dependencies", never
  // "clean". Firing GitHub's reader with a GitLab token — what an unrouted call would have done — is
  // the bug this line closes.
  const expPromise: Promise<SecurityExposure | null> = token && enrich.securityExposure
    ? enrich.securityExposure(parsed.owner, parsed.repo, snapshot.meta.headSha ?? snapshot.meta.defaultBranch, token, signal).catch(sensorFailed("securityExposure", null))
    : Promise.resolve(null);
  const activityPromise: Promise<number[] | null> = token && enrich.commitActivity
    ? enrich.commitActivity(parsed.owner, parsed.repo, token, signal).catch(() => null)
    : Promise.resolve(null);
  // Deepening pass — the two platform-observed enrichments. Both are one bounded REST call, token-gated
  // like governance (rate-limit hygiene; the App's existing Checks:read covers suites on private repos,
  // Actions:read is optional and its absence degrades to null), and both fold ADDITIVELY into the
  // deterministic scores (analyze/platform-signals.ts, security/checks.ts). Score-bearing, so awaited
  // with the others before analysis.
  const scoredSha = snapshot.meta.headSha ?? pinnedRef ?? snapshot.meta.defaultBranch;
  const appInventoryPromise: Promise<AppInventory | null> = token && enrich.appInventory
    ? enrich.appInventory(parsed.owner, parsed.repo, scoredSha, token, signal).catch(sensorFailed("appInventory", null))
    : Promise.resolve(null);
  const ciHealthPromise: Promise<CiHealth | null> = token && enrich.ciHealth
    ? enrich.ciHealth(parsed.owner, parsed.repo, snapshot.meta.defaultBranch, token, signal).catch(sensorFailed("ciHealth", null))
    : Promise.resolve(null);
  // W4 — deployments, the outcome anchor. Token-gated and BEST-EFFORT: a repo that doesn't use
  // GitHub Deployments returns an empty list, and no read scope returns null → no rows, which the
  // outcome views render as "not measured" rather than as a zero failure rate. It never blocks or
  // fails a scan; deployments are an enrichment, not a score input.
  //
  // It is the LONGEST read here — up to 21 strictly-sequential REST calls (sequential on purpose:
  // a parallel page trips GitHub's secondary rate limit, see DEPLOYMENT_PAGE_SIZE) — and it used to
  // be started without the abort signal and awaited OUTSIDE the Promise.all below, in the return
  // object literal. That put its whole sequential tail on the critical path AFTER every other
  // enrichment had already resolved. It now starts here like its siblings, carries the signal like
  // its siblings, and is awaited WITH them, so its calls overlap theirs instead of following them.
  const deploymentsPromise: Promise<DeploymentRecord[]> = token && enrich.deployments
    ? enrich.deployments(parsed.owner, parsed.repo, token, signal).catch(sensorFailed("deployments", []))
    : Promise.resolve([]);
  // Context Health (W4): last-modified per detected guidance file. Deliberately NOT token-gated —
  // the /commits?path= endpoint answers anonymously within rate limits — and pinned to the commit
  // actually scored (else the read ref) so the freshness matches the snapshot. Bounded to ≤3 calls;
  // any failure degrades per-file to "freshness unknown" instead of failing the scan.
  const guidancePaths = pickGuidanceFiles(snapshot.tree).map((f) => f.path);
  const guidanceFreshnessPromise: Promise<GuidanceFreshness[]> = guidancePaths.length && enrich.guidanceFreshness
    ? enrich.guidanceFreshness(
        parsed,
        snapshot.meta.headSha ?? pinnedRef ?? snapshot.meta.defaultBranch,
        guidancePaths,
        { token, signal },
      ).catch(() => guidancePaths.map((path) => ({ path })))
    : Promise.resolve([]);

  // THE FRAME TABLE. `fetch` → `tree` → `files` (45) → *this* → `analyze` (62) → `score` → `compose`
  // (95) → `done`. Everything between 45 and 62 is GitHub I/O — PR pages, governance, security
  // posture and exposure, the App inventory, CI health, deployments — and the UI used to read
  // "Analyzing signals across 9 dimensions…" for the whole of it, because the `analyze` frame was
  // emitted BEFORE the await below. The copy now describes what is actually happening; `analyze`
  // moves to where the analysis really starts.
  //
  // It reuses the `analyze` STAGE ID rather than introducing an `enrich` one: the stage union is a
  // closed type read by the fleet stream fold (src/lib/scan-stage.ts), the report status strip and
  // the cockpit lane, so a new id is a cross-cutting change rather than a progress-copy one.
  emit({ stage: "analyze", message: "Reading GitHub signals (pull requests, governance, security)…", pct: 52 });
  const [prResult, governance, securityPosture, securityExposure, appInventory, ciHealth, deployments] = await Promise.all([
    prPromise,
    govPromise,
    secPromise,
    expPromise,
    appInventoryPromise,
    ciHealthPromise,
    deploymentsPromise,
  ]);
  emit({ stage: "analyze", message: `Analyzing signals across ${DIMENSIONS.length} dimensions…`, pct: 62 });

  return {
    snapshot,
    prStats: prResult?.stats ?? null,
    // Read AFTER every enrichment promise has settled, so no rejection can land later than this line.
    sensorFailures: SENSOR_ORDER.filter((id) => failedSensors.has(id)),
    // graphql.ts sets `partial` when the PR page came back truncated (null nodes / an `errors` array on a
    // 200). Such results must not be treated as authoritative or cached — so `prPartial` IS consumed by
    // the caller (the poisoning guard): it appends a reliability warning and stamps the typed
    // `report.prPartial` flag classifyScanResult reads to refuse caching/persisting this scan as
    // authoritative — instead of a truncated slice silently deflating D6/D7/D8 on large or
    // rate-limited repos.
    prPartial: prResult?.partial ?? false,
    prFetchFailed,
    // The AI-attributed PRs as EVIDENCE ROWS (the population behind aiInvolvedRate/aiGovernedRate),
    // extracted from the same fetched nodes. Empty on an anonymous scan — GraphQL needs a token — and
    // that emptiness means "not observable here", never "this repo has no AI changes".
    aiChanges: prResult?.aiChanges ?? [],
    // W4 — resolved in the Promise.all above alongside every other enrichment (the persister needs it
    // in the same transaction as the scan row, and it is bounded: one list page + one status call each).
    deployments,
    governance,
    securityPosture,
    securityExposure,
    appInventory,
    ciHealth,
    activityPromise,
    guidanceFreshnessPromise,
  };
}
