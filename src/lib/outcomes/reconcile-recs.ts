// The `kind: "recommendation"` writer for the intervention outcome ledger (moonshot #9).
//
// ── Why this module exists at all ────────────────────────────────────────────────────────────────
//
// The design dossier for #9 named `reconcileDoneRec` (src/lib/report/compare.ts) as the write hook for
// recommendation outcomes. That premise is FALSE and the correction is the shape of this file:
// `reconcileDoneRec` is a PURE, client-imported function with no data access, and its callers are a
// client row component and `diffScans`, which runs inside a page render. There is no write seam there,
// and a page render writing to a fact table would be wrong — every reload would re-measure, and an
// anonymous viewer's render would author a tenant's evidence.
//
// So the outcome is produced HERE, on the server, off the durable `RecommendationEvent` rows that the
// status log already writes (`kind: "status"`, `toValue: "done"`), invoked from the same tick that
// verifies merged PRs. Same semantics — `reconcileDoneRec` is imported to classify the pair, so the
// ledger and the report row can never disagree about what "closed and it moved" means — and
// `compare.ts` is not touched by one line.
//
// ── What it declines to record ───────────────────────────────────────────────────────────────────
//
// `not-measured` (the dimension was absent on one of the two scans) writes NO ROW. A recommendation
// outcome is a claim about ITS DIMENSION; with the dimension unscored on one side there is no
// dimension-attributed measurement, and recording the whole-scan movement under a single closed gap
// would be exactly the fabricated attribution this ledger exists to avoid. The pair writer then
// applies the second refusal — the two sides must also agree on the instrument.

import { listDoneRecCandidates, recordOutcomesForScanPairs, RECONCILE_MAX } from "@/lib/db/outcomes";
import type { OutcomePairInput } from "@/lib/db/outcomes";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import { reconcileDoneRec } from "@/lib/report/compare";
import type { DimensionId } from "@/lib/types";

export interface ReconcileResult {
  /** Ledger rows written (or refreshed — the write is an upsert on the pair identity). */
  written: number;
  /** Done recommendations examined this tick. */
  considered: number;
  /** Examined but not yet measurable: no later scan, or the dimension absent on one side. */
  unmeasured: number;
  /** Unreconciled closes this tick did NOT reach — the coverage the caller (and the docs) can state
   *  honestly instead of implying the ledger has seen every close. A FLOOR when `truncated`. */
  remaining: number;
  /** More closes were waiting than the read counts, so `remaining` is a floor, not a total. */
  truncated: boolean;
}

/**
 * Mirror every measurable `done` recommendation into the ledger. Idempotent: re-running writes the
 * same rows over the same unique key, so it is safe on a poll tick.
 *
 * Best-effort by construction — the caller is the ops refresh loop, and a ledger write must never be
 * able to fail the loop that verifies PRs.
 */
export async function reconcileRecommendationOutcomes(
  orgId: string,
  limit = RECONCILE_MAX,
): Promise<ReconcileResult> {
  let written = 0;
  let unmeasured = 0;
  let considered = 0;
  let remaining = 0;
  let truncated = false;
  try {
    const page = await listDoneRecCandidates(orgId, limit);
    remaining = page.remaining;
    truncated = page.truncated;
    considered = page.candidates.length;

    // Classify first, write second. Everything the ledger declines — no rescan yet, or a dimension
    // absent on one bookend — is counted here and never reaches the writer, so the batched write below
    // carries only pairs that could legitimately become rows.
    const pairs: OutcomePairInput[] = [];
    for (const c of page.candidates) {
      if (!c.afterScanId) {
        unmeasured += 1; // awaiting the rescan that would measure the close
        continue;
      }
      const reconciliation = reconcileDoneRec(c.dimId as DimensionId, c.beforeDimScore, c.afterDimScore);
      if (reconciliation.state === "not-measured") {
        unmeasured += 1;
        continue;
      }
      pairs.push({
        orgId,
        repoFullName: c.repoFullName,
        kind: "recommendation",
        // The SAME identity the sandbox, the carry-forward diff and the org decisions use, so one
        // gap has one key across every surface that measures or remembers it.
        identityKey: recommendationMatchKey(c.dimId, c.title),
        dimId: c.dimId,
        beforeScanId: c.beforeScanId,
        afterScanId: c.afterScanId,
        interventionAt: c.doneAt,
        sourceRowId: c.recommendationId,
      });
    }
    // One bookend read for the whole set. A 50-candidate tick used to issue ~150 sequential queries
    // (one findFirst per candidate to locate the after-scan, then two findUniques per candidate inside
    // the per-pair writer); it now issues five reads in total, four of them here and in the listing.
    for (const ok of await recordOutcomesForScanPairs(pairs)) {
      if (ok) written += 1;
      else unmeasured += 1; // the instrument disagreed — refused by the writer, correctly
    }
  } catch (err) {
    console.warn("[outcomes] recommendation reconcile failed", err instanceof Error ? err.message : err);
  }
  return { written, considered, unmeasured, remaining, truncated };
}
