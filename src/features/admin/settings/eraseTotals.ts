// Pure result types + totals arithmetic for the org data-erasure control (G2-34). No JSX and no
// hooks, so deliberately NO "use client": the card, the outcome view and their tests all import it.
// Split out of DataErasureOutcome.tsx to keep that file under the 200-LOC `src/features/**` cap once
// the audit disposition was wired through it.
//
// WHY THERE ARE THREE AUDIT FIELDS AND NOT ONE. `includeAudit: true` resolves to
// `auditDisposition: "redact"`, not `"delete"` (resolveAuditDisposition, src/lib/db/retention.ts),
// and POST /api/org/erase answers a genuine `"delete"` with 409 unless the deployment sets
// ERASE_AUDIT_FORCE=1. So on every path this UI can actually reach, `auditDeleted` is 0 and the real
// casualty count is `auditRedacted`. A receipt that reads only `auditDeleted` therefore reports
// "0 · audit trail kept" after redacting the entire trail — the opposite of what happened, on the one
// control whose whole job is to be honest about an irreversible act.

/** What an erase did (or would do) to the audit trail. Mirrors AuditDisposition in db/retention.ts. */
export type AuditDisposition = "keep" | "redact" | "delete";

/** The JSON shape POST /api/org/erase returns (EraseResult, plus the 207-only `resumable`/`error`). */
export interface EraseResponse {
  orgSlug: string;
  scope: "org" | "repo";
  repoFullName?: string;
  reposProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  /** Audit rows DESTROYED — only ever non-zero for `auditDisposition: "delete"`. */
  auditDeleted: number;
  /** Audit rows reduced to identifier-only form. The count the checkbox path actually produces. */
  auditRedacted?: number;
  /** What the call did to the trail. Optional at the wire: derived from the counts when absent. */
  auditDisposition?: AuditDisposition;
  stoppedEarly: boolean;
  complete: boolean;
  audited: boolean;
  /** 207 only: the erase stopped at a batch boundary — repeat the request to continue. */
  resumable?: boolean;
  /** 207 only: the route's own description of the degraded outcome. */
  error?: string;
}

/** Running totals across every pass of a resumed erase — one pass's counts alone would under-report. */
export interface EraseTotals {
  passes: number;
  reposProcessed: number;
  scansDeleted: number;
  dimensionsDeleted: number;
  recommendationsDeleted: number;
  recommendationEventsDeleted: number;
  auditDeleted: number;
  auditRedacted: number;
}

export const ZERO_TOTALS: EraseTotals = {
  passes: 0,
  reposProcessed: 0,
  scansDeleted: 0,
  dimensionsDeleted: 0,
  recommendationsDeleted: 0,
  recommendationEventsDeleted: 0,
  auditDeleted: 0,
  auditRedacted: 0,
};

export function addPass(totals: EraseTotals, r: EraseResponse): EraseTotals {
  return {
    passes: totals.passes + 1,
    // Repos are re-walked on a resumed pass, so the max is the honest count of repos touched.
    reposProcessed: Math.max(totals.reposProcessed, r.reposProcessed),
    scansDeleted: totals.scansDeleted + r.scansDeleted,
    dimensionsDeleted: totals.dimensionsDeleted + r.dimensionsDeleted,
    recommendationsDeleted: totals.recommendationsDeleted + r.recommendationsDeleted,
    recommendationEventsDeleted: totals.recommendationEventsDeleted + r.recommendationEventsDeleted,
    auditDeleted: totals.auditDeleted + r.auditDeleted,
    auditRedacted: totals.auditRedacted + (r.auditRedacted ?? 0),
  };
}

/**
 * What this response says happened to the trail. The server sends `auditDisposition` explicitly; the
 * fallback reads the counts, so a body from an older deploy (or a truncated one) still reports what it
 * did rather than defaulting to the reassuring answer.
 */
export function auditDispositionOf(r: EraseResponse): AuditDisposition {
  if (r.auditDisposition) return r.auditDisposition;
  if ((r.auditRedacted ?? 0) > 0) return "redact";
  if (r.auditDeleted > 0) return "delete";
  return "keep";
}

/** Audit rows this pass touched, whichever way it touched them. */
export function auditAffected(r: EraseResponse): number {
  return r.auditDeleted + (r.auditRedacted ?? 0);
}

/** Audit rows touched across every pass. */
export function auditAffectedTotal(t: EraseTotals): number {
  return t.auditDeleted + t.auditRedacted;
}

/** The parenthetical the counts table and the preview panel both use, so one modal cannot describe the
 *  same disposition two different ways before and after the act. */
export function auditDispositionHint(d: AuditDisposition): string {
  return d === "keep" ? "(trail kept)" : d === "delete" ? "(destroyed)" : "(redacted to identifier-only)";
}

/** The footer's one-line summary of what became of the trail. */
export function auditDispositionSummary(d: AuditDisposition): string {
  return d === "keep"
    ? "audit trail kept"
    : d === "delete"
      ? "audit trail destroyed"
      : "audit trail redacted to identifier-only";
}
