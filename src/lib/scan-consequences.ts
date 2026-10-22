// The consequences of a fresh scan beyond its own row, in ONE place for every executor.
//
// A new authoritative row drives three things: the practice ADOPTION ledger (MOONSHOT #33), the
// regression / promotion alert, and the scan-fed Shared Org Memory. Until 2026-10-22 they ran only
// inside `cacheAndPersistScan` (the two interactive single-repo routes), so the fleet's executors -
// the queue worker (cadence, push, Scan-all, an import's queued tail) and the import route's inline
// head - each re-derived a subset: the worker fired the alert only, the import head nothing, and the
// degrade-to-mock guard held for push alone. Every caller now goes through `runScanConsequences`
// (and the fleet through `persistFleetScan`), so the next consequence is added here once.
//
// This module deliberately imports nothing from `scan-finalize.ts` (which re-exports the
// classification below), so the worker does not drag the interactive quota/viewer layer with it.

import { getOrgId, getScanReportByCommit, persistScanReport, type PersistResult } from "@/lib/db";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { recordScanMemories } from "@/lib/memory/scan-feed";
import { reconcilePracticeAdoption } from "@/lib/db/practice-adoption";
import { degradeTo } from "@/lib/scan-read-door";
import type { ScanReport } from "@/lib/types";

/** The cache-poisoning guards: a degrade-to-mock or low-coverage report must skip both caches. */
export interface ScanResultClass {
  /** The LLM was requested but the engine fell back to MockProvider (transient failure) - no real
   *  inference, deterministic floor, so it must NOT be cached/persisted under the ::llm key. */
  degradedToMock: boolean;
  /** Silent per-file fetch failures degraded coverage without failing the LLM - skip caching too. */
  lowCoverage: boolean;
  /** The PR slice behind D6/D7/D8 was truncated (graphql.ts's `partial`), so the scores understate.
   *  graphql.ts documents that partial results must not be cached; until now nothing read the flag and
   *  a truncated slice was persisted as authoritative - silently deflating large/rate-limited repos. */
  partialPrSlice: boolean;
}

/**
 * May this report be cached and persisted? Written over the classification's VALUES rather than an
 * enumerated list of flags, so adding a vector to {@link ScanResultClass} / {@link classifyScanResult}
 * closes persistence AND every caller that gates on authority (the stream route's completion email,
 * via `finalizeScanRun`'s `willPersist`) with no edit at a single call site. Every field of
 * `ScanResultClass` is, by construction, a "this report is poisoned" boolean.
 */
export function isAuthoritativeScanResult(cls: ScanResultClass): boolean {
  return !Object.values(cls).some(Boolean);
}

/** Derive the cache-poisoning guards from a report. Identical in every scan executor. */
export function classifyScanResult(report: ScanReport, mock: boolean): ScanResultClass {
  return {
    partialPrSlice: report.prPartial === true,
    degradedToMock: report.engine.provider === "mock" && !mock,
    lowCoverage: report.confidence < 0.5,
  };
}

/** The repo's latest persisted report, read BEFORE a fresh one lands (the alert's caller contract).
 *  Best-effort: a failed read yields a null baseline, which every consequence treats as a first scan. */
export async function readScanBaseline(fullName: string, orgSlug: string, tag: string): Promise<ScanReport | null> {
  const [owner = "", name = ""] = fullName.split("/");
  try {
    return await getScanReportByCommit(owner, name, { orgSlug }).catch(degradeTo(`${tag}: regression baseline (getScanReportByCommit)`, null));
  } catch (err) {
    return degradeTo(`${tag}: regression baseline (getScanReportByCommit)`, null)(err);
  }
}

/** One consequence step: awaited, and a throw is logged and swallowed so the next step still runs. */
async function step<T>(tag: string, label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (err) {
    console.error(`[${tag}] ${label} failed (scan unaffected)`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Everything a NEW authoritative scored row sets in motion, in order: reconcile the practice ADOPTION
 * ledger against the census this scan took, check the regression / promotion alert, then feed Shared
 * Org Memory from the alert's own verdict (so the memory can never disagree with it). Call it only
 * after a new row was written (not a dedup, not a failed persist). Never rejects: each step is
 * guarded on its own, so a ledger hiccup cannot cost the alert, and none of them can fail or roll
 * back a scan that has already landed.
 */
export async function runScanConsequences(
  prev: ScanReport | null,
  report: ScanReport,
  opts: { orgSlug: string; tag: string },
): Promise<void> {
  const { orgSlug, tag } = opts;
  const orgId = (await step(tag, "org lookup", () => getOrgId(orgSlug).catch(degradeTo(`${tag}: getOrgId`, null)))) ?? undefined;
  if (orgId) {
    // The scan row's id is not returned by persistScanReport; the commit sha is the stable identity of
    // what was observed, which is what `lastScanId` is read as ("as of what").
    // reconciles to nothing rather than asserting that every tracked artifact vanished.
    await step(tag, "practice adoption reconcile", () =>
      reconcilePracticeAdoption(orgId, `${report.repo.owner}/${report.repo.name}`, report.repo.headSha ?? "", report.practiceShape),
    );
  }
  const outcome = await step(tag, "regression alert", () => checkAndAlertRegression(prev, report, { orgId, orgSlug }));
  await step(tag, "scan memory feed", () =>
    recordScanMemories(orgId, prev, report, outcome ?? { regressed: false, verdict: null }),
  );
}

/** The scan outcome a fleet executor records when the provider degraded to the deterministic floor.
 *  A failed outcome on purpose: the 6h failure backoff then covers the outage instead of every scan in it. */
export const DEGRADED_SCAN_ERROR = "LLM unavailable: not persisted";

/** What a fleet persist did. `degraded` = the floor was refused (nothing written, nothing alerted). */
export type FleetPersist = { degraded: true } | { degraded: false; persisted: PersistResult | null };

/**
 * The fleet executors' persist: refuse a degraded-to-mock floor, persist, then run the consequences on
 * a NEW row. A provider outage still returns a report stamped "mock" - the deterministic FLOOR -
 * and persisting it would make the floor the repo's current reading and the next regression baseline,
 * with an alert blaming the customer's repo for our outage. A mock the caller ASKED for (a free
 * preview import) is not degraded and persists as before. Only `degradedToMock` is applied here:
 * low-coverage and partial-PR-slice rows stay persisted on the fleet side as they always were, since
 * refusing them would move what is charged. A persist throw propagates (the caller's refund rule
 * owns it); the consequences never throw.
 */
export async function persistFleetScan(
  report: ScanReport,
  opts: { orgSlug: string; mockRequested: boolean; prev: ScanReport | null; tag: string },
): Promise<FleetPersist> {
  if (classifyScanResult(report, opts.mockRequested).degradedToMock) return { degraded: true };
  const persisted = await persistScanReport(report, { orgSlug: opts.orgSlug });
  if (persisted && !persisted.deduped) await runScanConsequences(opts.prev, report, opts);
  return { degraded: false, persisted };
}
