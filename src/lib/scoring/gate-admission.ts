// The IO seam between the gate's policy FOLD and the two org-scoped sources it now reads: the
// per-repo admission decision (#8) and the conformance ledger that `requireChecks` is judged against
// (#16). `gate.ts` stays pure — it is the evaluator and the vocabulary; this is the only place that
// goes to the database on the gate's behalf, and BOTH gate surfaces call it, so the public endpoint
// and the merge-blocking Check Run cannot drift into enforcing different bars.
//
// Two rules, both inherited from what the org-policy read already does here:
//
//  1. TIGHTEN-ONLY. The overlay is returned as a `GatePolicy` and the caller folds it with
//     `tightenGatePolicy`. It is never assigned over anything. On the unauthenticated endpoint that
//     is the whole safety argument: an admission row can only ever RAISE a bar, so reading one can
//     never turn the public gate into a way to get a weaker verdict.
//  2. FAIL CLOSED ON A READ ERROR. `getRepoAdmission` returns null WITHOUT throwing for every
//     legitimate "no decision here" case (no DB, unknown org, untracked repo, no passport). So a
//     throw means exactly one thing — we could not determine the bar — and the caller must say that
//     (503, no verdict) rather than publish a verdict against a bar it could not read. This mirrors
//     `getOrgGatePolicy` precisely, and for the same reason: silently degrading to a weaker bar on
//     the one control that blocks merges is how an outage becomes a green build.

import type { CheckLevel } from "@/lib/standard/check-ids";
import type { GatePolicy } from "@/lib/scoring/gate";
import { admissionGateOverlay, type AdmissionTierSource, type AdmissionMode } from "@/lib/org/admission";
import { getRepoAdmission } from "@/lib/db/org-admission";
import { loadControlMatrix } from "@/lib/db/org-conformance";

/** The triple a CI log needs to explain *why* this repository was held to this bar. */
export interface AdmissionVerdictInfo {
  mode: AdmissionMode;
  tier: string | null;
  source: AdmissionTierSource;
}

export interface AdmissionLayer {
  /** The tighten-only fragment. `{}` when there is no admission row — the byte-identical no-op case. */
  overlay: GatePolicy;
  /** Null when no row applied, so the verdict body omits the key entirely rather than nulling it. */
  admission: AdmissionVerdictInfo | null;
}

/**
 * Resolve one repo's admission layer. Throws on a read failure (see rule 2); returns an empty
 * overlay and a null triple for every legitimate absence.
 *
 * The tier that reaches the overlay is the GRANTED one, and only when a tier was assessed at all —
 * the same rule `compileStance` applies, kept here rather than imported wholesale so this seam does
 * not have to fetch a stance and a repo's facts just to answer "which floors apply".
 */
export async function resolveAdmissionLayer(orgSlug: string, repoFullName: string): Promise<AdmissionLayer> {
  const row = await getRepoAdmission(orgSlug, repoFullName);
  if (!row) return { overlay: {}, admission: null };
  const assessed = row.derivedTier !== null;
  const tier = assessed ? row.grantedTier : null;
  return {
    overlay: admissionGateOverlay(row.mode, tier),
    admission: {
      mode: row.mode,
      tier,
      source: !assessed ? "none" : row.decidedBy ? "granted" : "derived",
    },
  };
}

/**
 * The per-check levels of this repo's LATEST conformance report, for `requireChecks`.
 *
 * Null — the honest-null the gate rule skips on — for every case where the measurement was never
 * due: no database, no org row, no report at all, or a summary-only report (a doctor older than spec
 * 0.3.0, which carries no findings and therefore proves nothing per check). A read failure ALSO
 * returns null rather than throwing, and that asymmetry with the admission read above is deliberate:
 * `requireChecks` fails a repo for its OWN reported failure, so an unreadable ledger means we cannot
 * name a failing control — which is a skip, not a bar we lowered. The admission overlay is the
 * opposite shape (an unreadable row could have been the strict one), which is why it fails closed.
 */
export async function loadCheckStates(orgSlug: string, repoFullName: string): Promise<Record<string, CheckLevel> | null> {
  let rows;
  try {
    rows = await loadControlMatrix(orgSlug, { repos: [repoFullName], historyPerRepo: 1 });
  } catch (err) {
    console.warn("[gate] conformance ledger read failed — requireChecks skipped, not failed", err instanceof Error ? err.message : err);
    return null;
  }
  const row = rows?.find((r) => r.repoFullName === repoFullName);
  if (!row || row.summaryOnly || row.checks.length === 0) return null;
  const out: Record<string, CheckLevel> = {};
  for (const c of row.checks) out[c.check] = c.level;
  return out;
}
