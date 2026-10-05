// ONE SCAN LIFECYCLE — the sequence both single-repo entry points run, owned here instead of
// hand-copied into two HTTP handlers.
//
// The pre-scan GATES were already single-sourced into `src/lib/scan-gates.ts` and the persist guards
// into `src/lib/scan-finalize.ts`, for the reason that file states plainly: "Both routes ran
// byte-identical copies of the burst rate limiter ... a fix to one silently missed the other." What
// was never extracted is the SEQUENCE between those helpers — coordinate, scope, head + cache lookup,
// cached return, coalesce, classify, refund, cache and persist, salvage — so /api/scan and
// /api/scan/stream each carried ~150 lines of identical ordering, held together by prose and a
// route-source test. They had already drifted, in three ways that reached users:
//
//   1. The stream parsed GITHUB coordinates only, so every `gitlab:group/project` the scan form emits
//      (src/components/scan/normalizeScanRepo.ts) answered 400 "Enter a valid GitHub repository URL"
//      on the live path while POST /api/scan scanned it.
//   2. The any-commit error SALVAGE existed on the JSON route only, so a transient GitHub failure five
//      minutes into a live scan was a dead end where the other endpoint served last week's report.
//   3. A coalesce joiner refunded the credit on the stream and only the quota on the JSON route —
//      harmless solely because coalescing is confined to the unmetered anonymous path, an invariant
//      nothing pinned.
//
// WHAT IS SHARED AND WHAT IS NOT. Everything from the coordinate to the persisted report is here, and
// the routes are adapters: they own their PROTOCOL (a JSON body versus SSE frames) and their GATE
// PLACEMENT, which is a legitimate difference and is therefore a parameter rather than a copy:
//
//   • /api/scan/stream gates at the top of the handler — reaching the stream already means a real
//     scan, and the quota/credit headers must be flushed when the stream opens. It passes no `preScan`.
//   • /api/scan gates AFTER the free cache-hit / peek / salvage returns, so hydrating a saved report
//     is unthrottled and costs nothing. It passes its peek block, its INVALID_URL answer and its gates
//     as `preScan`, which runs at the one declared slot between the cached return and the scan.
//
// THE REFUND LEDGER IS AN OBJECT, NOT SIX HAND-PLACED AWAITS. `createScanRefundLedger` names the five
// no-delivery situations once (`onCacheHit`, `onJoin`, `onDegrade`, `onDedup`, `onFailure`) and decides
// which meter each one hands back. Its table is asserted in scan-lifecycle.test.ts and the route-level
// half in src/app/api/scan/gate-order.test.ts. The thunks are read THROUGH the closure at refund time,
// so a route whose gates run inside `preScan` (the JSON one) can bind them after the ledger is built.

import { GitHubError, type ParsedRepo } from "@/lib/github/source";
import { forgeFullName, parseForgeUrl } from "@/lib/forge/registry";
import type { ForgeId } from "@/lib/forge/types";
import { scanRepository } from "@/lib/scan";
import { coalesceScan } from "@/lib/cache";
import {
  lookupCachedScan,
  lookupScopedScan,
  resolveHeadWithHint,
  type ScanCacheLookup,
} from "@/lib/scan-cache";
import { isScopedScan, scopeWarning } from "@/lib/scan-scope";
import type { ResolvedScanScope } from "@/lib/scan-scope-server";
import { getScanReportByCommit } from "@/lib/db";
import {
  cacheAndPersistScan,
  classifyScanResult,
  isAuthoritativeScanResult,
  type ScanResultClass,
} from "@/lib/scan-finalize";
import type { ScanProgress, ScanReport } from "@/lib/types";

export { isAuthoritativeScanResult };

/** The shared anonymous funnel's org slug. A literal on purpose: importing DEFAULT_ORG_SLUG would put
 *  `@/lib/db`'s constant surface into every route test's module mock. */
const PUBLIC_ORG = "public";

// ── COORDINATE ───────────────────────────────────────────────────────────────────────────────────

/**
 * What a scan URL resolves to. `parseForgeUrl` tries GitHub FIRST and `githubForge.parseUrl` IS
 * `parseRepoUrl`, so for every input that parsed before, `parsed` is the same object it always was —
 * byte-identical behaviour on the whole GitHub funnel.
 */
export interface ScanCoordinate {
  /** The forge-neutral coordinate, or null when nothing claimed the input. */
  parsed: ParsedRepo | null;
  forgeId: ForgeId;
  /**
   * The coordinate ONLY when it is a GitHub one. Every GitHub-native side path — installation-token
   * auth, the conditional head lookup, the scan cache, ref/sub-path resolution — is keyed on a GitHub
   * coordinate and only makes sense for one. Gating them on this (rather than teaching each one about
   * forges) is what keeps forge support a COORDINATE question: a non-GitHub scan simply takes the
   * token-less path it would take for an unauthenticated GitHub repo, and gets the same honest degrade.
   */
  ghParsed: ParsedRepo | null;
  /** The persisted identity — `owner/name` for GitHub, `gitlab:group/project` elsewhere. */
  repoIdentity: string;
}

export function resolveScanCoordinate(url: string): ScanCoordinate {
  const routed = parseForgeUrl(url);
  const forgeId: ForgeId = routed?.forge ?? "github";
  const parsed: ParsedRepo | null = routed
    ? {
        owner: routed.owner,
        repo: routed.repo,
        ...(routed.ref !== undefined ? { ref: routed.ref } : {}),
        ...(routed.prNumber !== undefined ? { prNumber: routed.prNumber } : {}),
      }
    : null;
  return {
    parsed,
    forgeId,
    ghParsed: forgeId === "github" ? parsed : null,
    repoIdentity: parsed ? forgeFullName(forgeId, parsed.owner, parsed.repo) : url,
  };
}

/**
 * The 400 body for an unparseable URL, shared so the two entry points cannot disagree about what a
 * valid repo URL IS. Each route renders it at its own placement: the stream answers it before the
 * quota consume at the top of the handler, the JSON route after its peek/salvage returns so a cache
 * probe keeps its cheap 204 contract. Both are before any monthly slot is consumed, which is the
 * property that matters — a typo must not burn one of the anonymous tier's free slots.
 */
export const INVALID_SCAN_URL = {
  error: "Enter a valid repository URL, e.g. https://github.com/owner/repo or https://gitlab.com/group/project.",
  code: "INVALID_URL",
} as const;

// ── REFUND LEDGER ────────────────────────────────────────────────────────────────────────────────

/**
 * Which meter is handed back in each situation where the scan delivered nothing new. Both meters bill
 * ON COMMIT, NOT ATTEMPT, and both refunds are idempotent, so a situation may fire more than one entry
 * without minting anything.
 */
export interface ScanRefundLedger {
  /** A cached report is free everywhere. (On a route that gates after the cache return there is simply
   *  nothing consumed yet, and both refunds are no-ops — the same call, a different amount of work.) */
  onCacheHit: () => Promise<void>;
  /** This caller received the OWNER's computation; its own consumed slot bought nothing. */
  onJoin: () => Promise<void>;
  /** No LLM inference ran and the deterministic floor is not the product a slot pays for. */
  onDegrade: () => Promise<void>;
  /** The commit was already scored, so no new row was written — but a report WAS delivered, which is
   *  why the free monthly slot stands and only the reserved credit comes back. */
  onDedup: () => Promise<void>;
  /** 404 / typo / upstream failure / client abort: the user received nothing. */
  onFailure: () => Promise<void>;
}

export function createScanRefundLedger(src: {
  refundQuota: () => Promise<void> | void;
  refundCredit: () => Promise<void> | void;
}): ScanRefundLedger {
  const both = async () => {
    await src.refundQuota();
    await src.refundCredit();
  };
  return {
    onCacheHit: both,
    onJoin: both,
    onDegrade: both,
    onFailure: both,
    onDedup: async () => {
      await src.refundCredit();
    },
  };
}

// ── TARGET (scope + head + cache lookup) ─────────────────────────────────────────────────────────

/** What the scan is aimed at, once the scope and the caches have had their say. */
export interface ScanTarget {
  /** The cache entry this scan reads and writes, or null for the uncacheable (token / non-GitHub) path. */
  lookup: ScanCacheLookup | null;
  /** The repo's REAL default-branch head — the yardstick `isScopedScan` measures the requested ref
   *  against, so `?ref=main` stays an ordinary, fully-cached, persisted scan. */
  defaultHeadSha: string | null;
  /** Is this scan about something OTHER than "the whole repo at its default-branch head"? */
  scoped: boolean;
  /** The commit ingestion is pinned to, so a push landing mid-scan can't key the report under a
   *  different commit than it actually scored. */
  pinnedHeadSha: string | undefined;
}

/**
 * Resolve the cache/scope target for one scan. The SCOPE ERROR is resolved by the caller (both routes
 * render it identically as a pre-stream JSON response, and the stream needs it before the stream
 * opens); everything after it lives here, because the three rules it encodes are cache-safety rules
 * and two hand-kept copies of a cache-safety rule is how a collision gets reintroduced:
 *
 *   • a SCOPED request is never answered from, or written to, the whole-repo entry;
 *   • a sub-path scan is scoped no matter what the head is, so it skips the whole-repo lookup entirely
 *     and resolves the head with the cheap conditional hint purely to pin the scoped key to a commit;
 *   • a ref that resolves to the default head is NOT scoped, so it keeps full cache reuse.
 */
export async function resolveScanTarget(args: {
  coordinate: ScanCoordinate;
  scoping: ResolvedScanScope;
  token: string | undefined;
  noAmbientToken: boolean;
  mock: boolean;
  fresh: boolean;
}): Promise<ScanTarget> {
  const { ghParsed } = args.coordinate;
  const { scoping, token } = args;
  // Ambient-guarded by construction: a ref resolve must never confirm a private repo's branches
  // through the operator PAT.
  const scopeToken = token ?? (args.noAmbientToken ? undefined : process.env.GITHUB_TOKEN);

  let lookup: ScanCacheLookup | null = null;
  let defaultHeadSha: string | null = null;
  if (ghParsed && !token && Boolean(scoping.scope.subPath)) {
    defaultHeadSha = await resolveHeadWithHint(ghParsed, scopeToken);
  } else if (ghParsed && !token) {
    // Resolve the head SERVER-SIDE (a conditional head request — a free 304 when unchanged), never
    // from a client-supplied sha: lookup.headSha PINS ingestion and is stamped and persisted as the
    // report's commit identity, so a caller could otherwise have a cherry-picked flattering commit
    // scored, saved, and later served as the repo's "most recent" public report. [security]
    lookup = await lookupCachedScan({ parsed: ghParsed, useLLM: !args.mock, orgSlug: PUBLIC_ORG, fresh: args.fresh });
    defaultHeadSha = lookup.headSha;
  }

  // A private (token) scan has no resolved default head here, so any requested scope counts as
  // scoped: the safe side.
  const scoped = scoping.requested && isScopedScan(scoping.scope, token ? null : defaultHeadSha);
  if (scoped) {
    // Swap in a SCOPED lookup — keyed on the ref's OWN commit sha plus an explicit sub-path segment,
    // memory tier only. This also DISCARDS any whole-repo `cached` report the default lookup found:
    // serving that for a ref/sub-path request would answer a different question than the one asked.
    lookup =
      ghParsed && !token
        ? lookupScopedScan({
            parsed: ghParsed,
            useLLM: !args.mock,
            refSha: scoping.pinSha ?? defaultHeadSha,
            subPath: scoping.scope.subPath,
            fresh: args.fresh,
          })
        : null;
  }

  return {
    lookup,
    defaultHeadSha,
    scoped,
    pinnedHeadSha: (scoped ? (scoping.pinSha ?? defaultHeadSha) : lookup?.headSha) ?? undefined,
  };
}

// ── SALVAGE ──────────────────────────────────────────────────────────────────────────────────────

/**
 * "Serve the latest persisted PUBLIC report" — the any-commit salvage read, single-sourced across its
 * callers (the peek recent/latest probe, and the failed-scan fallback on BOTH entry points). Returns
 * the repo's most recent persisted report, or null. Never scans: one DB read, zero GitHub/LLM cost,
 * best-effort (a DB blip yields null).
 *
 * SECURITY — the reason this is ONE function: every caller serves out of the SHARED anonymous store,
 * so a PRIVATE snapshot must never leave here (defense-in-depth, the same gate as the CI gate), and
 * the read is confined to the anonymous public funnel (`parsed && !token`; token scans are per-tenant
 * and never share this store). Two copies of that guard meant one could silently drift open.
 */
export async function latestPublicReport(
  parsed: ParsedRepo | null,
  token: string | undefined,
): Promise<ScanReport | null> {
  if (!parsed || token) return null;
  const last = await getScanReportByCommit(parsed.owner, parsed.repo, {}).catch(() => null);
  return last && !last.repo.isPrivate ? last : null;
}

/**
 * The failed-scan fallback: when a live scan FAILS (transient upstream/LLM/rate-limit) but we have
 * scored this repo before, the most recent persisted report beats a hard error. Never on a client
 * abort (no one is waiting). Never on a SCOPED scan either — the salvaged report is the repo's
 * whole-repo default-branch reading, and silently answering with it would present a main-branch score
 * as the branch or package the user typed.
 */
export async function salvageScanFailure(
  err: unknown,
  args: { coordinate: ScanCoordinate; token: string | undefined; scoped: boolean },
): Promise<ScanReport | null> {
  if (isScanAbort(err) || args.scoped) return null;
  return latestPublicReport(args.coordinate.ghParsed, args.token);
}

/** A deliberate abort (client disconnect / scan timeout), not a scan error to report or salvage. */
export function isScanAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// ── FINALIZE ─────────────────────────────────────────────────────────────────────────────────────

export interface ScanFinalizeOutcome {
  /** The org the report was persisted under — possibly RE-TENANTED from the public funnel. */
  orgSlug: string;
  resultClass: ScanResultClass;
  /** No cache-poisoning vector fired, so this report may be cached and persisted. */
  authoritative: boolean;
  /**
   * Whether `cacheAndPersistScan` actually stored this report in the durable corpus, as a question the
   * ROUTE can ask without re-deriving the guard. The stream's completion email is gated on it: the
   * mail links a permalink that only resolves once the report is persisted, so every poisoning vector
   * must suppress the mail too, and a vector added to `classifyScanResult` closes both at once.
   */
  willPersist: boolean;
  deduped: boolean;
  persistedOk: boolean;
  durable: boolean;
}

/**
 * Re-tenant, classify, refund, cache and persist — the terminal stages of the pipeline, in one place.
 *
 * RE-TENANTING is the first step for a reason. A scan can read a PRIVATE repo while `orgSlug` is still
 * the shared `public` funnel (a caller-supplied body token on the JSON route; the ambient operator PAT,
 * which commonly has broad read access, on either). Persisting that under `public` would publish the
 * private report to every anonymous visitor, because the report page and history read the public org.
 * `scans-persist.ts` refuses the write as a backstop; this is the correct-placement half, and it now
 * runs for every path rather than for the body-token one only.
 */
export async function finalizeScanRun(
  report: ScanReport,
  args: {
    tag: string;
    coordinate: ScanCoordinate;
    orgSlug: string;
    mock: boolean;
    target: ScanTarget;
    ledger: ScanRefundLedger;
  },
): Promise<ScanFinalizeOutcome> {
  let orgSlug = args.orgSlug;
  if (report.repo?.isPrivate && orgSlug === PUBLIC_ORG) {
    orgSlug =
      report.repo.owner?.trim().toLowerCase() || args.coordinate.parsed?.owner.trim().toLowerCase() || orgSlug;
  }

  const resultClass = classifyScanResult(report, args.mock);
  const authoritative = isAuthoritativeScanResult(resultClass);
  const willPersist = !args.target.scoped && authoritative;
  if (resultClass.degradedToMock) await args.ledger.onDegrade();

  const { deduped, persistedOk, durable } = await cacheAndPersistScan(report, resultClass, {
    tag: args.tag,
    repo: args.coordinate.repoIdentity,
    orgSlug,
    lookup: args.target.lookup,
    // A scoped (ref / sub-path) report is about a different subject than "this repository" — keep it
    // out of the durable corpus and the regression-alert baseline. The scoped in-memory key can never
    // collide with the whole-repo one.
    persist: !args.target.scoped,
  });
  if (deduped) await args.ledger.onDedup();

  return { orgSlug, resultClass, authoritative, willPersist, deduped, persistedOk, durable };
}

// ── THE SEQUENCE ─────────────────────────────────────────────────────────────────────────────────

/** Everything the lifecycle needs that the route resolved first (coordinate, auth, scope, meters). */
export interface ScanLifecycleInput {
  /** The raw URL, passed to `scanRepository` verbatim so IT does the forge routing for ingestion. */
  url: string;
  coordinate: ScanCoordinate;
  orgSlug: string;
  token: string | undefined;
  noAmbientToken: boolean;
  scoping: ResolvedScanScope;
  mock: boolean;
  fresh: boolean;
  signal?: AbortSignal;
  /**
   * Individual tier (decision 5): whose standing decisions the prompt reads. A THUNK, read at scan
   * time, because /api/scan resolves it inside its gate slot (which runs after this input is built)
   * and must not resolve a viewer on a request its gates will refuse.
   */
  resolveDecisionOrgSlug?: () => string | undefined;
  ledger: ScanRefundLedger;
}

/** How one entry point delivers the lifecycle's outcomes in its own protocol. */
export interface ScanLifecycleAdapter<T> {
  /** Log tag for the persist layer (`scan` / `scan/stream`). */
  tag: string;
  /** Live progress sink. Absent on the JSON route, which has nowhere to put a frame. */
  onProgress?: (p: ScanProgress) => void;
  /** Fired when this caller attached to a run already under way, before the ledger's `onJoin`. */
  onJoin?: () => void;
  deliverCached: (report: ScanReport, source: ScanCacheLookup["source"]) => T | Promise<T>;
  /**
   * The ONE declared slot between the cached return and the scan, for a route that gates there: the
   * JSON route's peek/salvage returns, its INVALID_URL answer and its four pre-scan gates. Return a
   * value to answer the request; return null to proceed into the scan. The stream passes nothing —
   * it gated at the top of its handler, which is why its quota/credit headers can be flushed when the
   * stream opens.
   */
  preScan?: (target: ScanTarget) => Promise<T | null>;
  deliverResult: (report: ScanReport, outcome: ScanFinalizeOutcome) => T | Promise<T>;
  /** `salvaged` is the last persisted public report when one was available, else null. May throw to
   *  hand the error to the route's own mapper (what /api/scan does: `handleError` owns the statuses). */
  deliverFailure: (err: unknown, salvaged: ScanReport | null) => T | Promise<T>;
}

/**
 * Run one scan from coordinate to persisted report. The order below IS the contract, and it is the
 * only copy of it:
 *
 *   target → cached return → [route slot: peek / invalid URL / gates] → coalesced scan
 *          → (on failure: refund + salvage) → finalize (re-tenant, classify, refund, persist)
 *          → deliver
 */
export async function runScanLifecycle<T>(
  input: ScanLifecycleInput,
  adapter: ScanLifecycleAdapter<T>,
): Promise<T> {
  const target = await resolveScanTarget({
    coordinate: input.coordinate,
    scoping: input.scoping,
    token: input.token,
    noAmbientToken: input.noAmbientToken,
    mock: input.mock,
    fresh: input.fresh,
  });

  if (target.lookup?.cached) {
    await input.ledger.onCacheHit();
    return adapter.deliverCached(target.lookup.cached, target.lookup.source);
  }

  if (adapter.preScan) {
    const early = await adapter.preScan(target);
    if (early !== null) return early;
  }

  const doScan = (signal?: AbortSignal, emit = adapter.onProgress) =>
    scanRepository(input.url, {
      token: input.token,
      noAmbientToken: input.noAmbientToken,
      mock: input.mock,
      signal,
      ...(emit ? { onProgress: emit } : {}),
      headSha: target.pinnedHeadSha,
      ...((): { decisionOrgSlug?: string } => {
        const slug = input.resolveDecisionOrgSlug?.();
        return slug ? { decisionOrgSlug: slug } : {};
      })(),
      // The resolved ref sha (never the client's ref string) + the normalized sub-path. Omitted unless
      // genuinely scoped, so a `ref=main` request ingests byte-for-byte what a plain scan does.
      ...(target.scoped
        ? {
            ref: input.scoping.pinSha ?? undefined,
            subPath: input.scoping.scope.subPath,
            scopeCaveat: scopeWarning(input.scoping.scope),
          }
        : {}),
    });

  // Coalesce concurrent scans of the same uncached commit (anonymous cacheable path only) onto one run
  // so two callers don't each pay a full ingest + LLM. The token (private) path is per-tenant and
  // never shared, so it scans directly.
  let joined = false;
  let report: ScanReport;
  try {
    report = target.lookup
      ? await coalesceScan(
          target.lookup.cacheKey,
          (signal, emit) => doScan(signal, adapter.onProgress ? emit : undefined),
          input.signal,
          () => {
            joined = true;
            adapter.onJoin?.();
          },
          adapter.onProgress,
        )
      : await doScan(input.signal);
  } catch (err) {
    await input.ledger.onFailure();
    const salvaged = await salvageScanFailure(err, {
      coordinate: input.coordinate,
      token: input.token,
      scoped: target.scoped,
    });
    return adapter.deliverFailure(err, salvaged);
  }
  if (joined) await input.ledger.onJoin();

  const outcome = await finalizeScanRun(report, {
    tag: adapter.tag,
    coordinate: input.coordinate,
    orgSlug: input.orgSlug,
    mock: input.mock,
    target,
    ledger: input.ledger,
  });
  return adapter.deliverResult(report, outcome);
}

/** The shape /api/scan keeps a late-bound reference to so its headers can report the post-refund
 *  balance: structurally `ScanCreditHold` from scan-gates.ts, named here so the route does not have to
 *  declare a placeholder of an interface it imports only for a `let`. */
export interface ScanCreditHoldLike {
  remaining: number | null;
  refund: () => Promise<void>;
}

/** Re-exported so a route can map a known upstream outcome without importing the GitHub module just
 *  for the class. */
export { GitHubError };
