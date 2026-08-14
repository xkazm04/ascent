"use client";

// The RESULT half of the org data-erasure control (G2-34) — what the dialog shows once POST
// /api/org/erase has answered. Three outcomes, three different readings, and the whole point of this
// file is that they must never be flattened into one green "Done":
//
//  • 200 (complete && audited)  — a clean success. The only state that reads green.
//  • 207 with `resumable`       — the wall-clock budget stopped the erase at a batch boundary. Every
//                                 committed batch is durable, so this is neither failure nor success:
//                                 the primary action becomes "Continue erasing", which repeats the
//                                 identical (idempotent) request. Amber, never green, never an error.
//  • 207 with `audited: false`  — the deletes happened and cannot be undone, but the `data.erased`
//                                 trace was NOT written. For an audit product that is a degraded
//                                 outcome the owner has to act on, so it is rendered as a warning with
//                                 the "record this out of band" instruction — never as a clean success.
//
// (The two degraded states can co-occur; both blocks render.)

import { ModalBody, ModalFooter, ModalHeader } from "@/components/ui";

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
  auditDeleted: number;
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
}

export const ZERO_TOTALS: EraseTotals = {
  passes: 0,
  reposProcessed: 0,
  scansDeleted: 0,
  dimensionsDeleted: 0,
  recommendationsDeleted: 0,
  recommendationEventsDeleted: 0,
  auditDeleted: 0,
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
  };
}

const num = (n: number) => n.toLocaleString("en-US");

function Counts({ totals }: { totals: EraseTotals }) {
  const rows: [string, number][] = [
    ["Scans", totals.scansDeleted],
    ["Dimension rows", totals.dimensionsDeleted],
    ["Recommendations", totals.recommendationsDeleted],
    ["Recommendation events", totals.recommendationEventsDeleted],
    ["Repositories cleared", totals.reposProcessed],
    ["Audit entries", totals.auditDeleted],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2 border-b border-divider py-1">
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-slate-200">{num(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataErasureOutcome({
  slug,
  result,
  totals,
  busy,
  onResume,
  onClose,
}: {
  slug: string;
  result: EraseResponse;
  totals: EraseTotals;
  busy: boolean;
  onResume: () => void;
  onClose: () => void;
}) {
  const resumable = result.resumable === true || !result.complete;
  const clean = !resumable && result.audited;

  return (
    <>
      <ModalHeader
        kicker={resumable ? "Erasure incomplete" : result.audited ? "Erasure complete" : "Erased without a trace"}
        title={
          resumable
            ? "Stopped at a safe boundary: run it again to continue"
            : result.audited
              ? `Erased every scan in ${slug}`
              : `Erased ${slug}, but the compliance record was not written`
        }
        context={slug}
      />
      <ModalBody className="space-y-4">
        {resumable && (
          <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
            This organization is too large to erase inside one request, so the erase stopped cleanly at a batch
            boundary instead of being cut off mid-delete. Everything counted below is already gone for good; the rest
            is still here. Running it again picks up exactly where it stopped. Repeating the request is safe.
          </p>
        )}
        {!result.audited && (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger-soft"
          >
            The deletes below were applied and cannot be undone, but the <code>data.erased</code> audit entry could
            not be written. This erasure has no trace in the audit trail. Record it out of band (ticket, DSR log)
            before you close this dialog.
          </p>
        )}
        {clean && (
          <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
            Every scan in scope is erased and the <code>data.erased</code> audit entry is written. The organization,
            its repositories, its members and your configuration are untouched.
          </p>
        )}
        <Counts totals={totals} />
        <p className="font-mono text-xs text-slate-500">
          {totals.passes === 1 ? "One pass" : `${totals.passes} passes`}
          {result.auditDeleted > 0 || totals.auditDeleted > 0 ? " · audit trail included" : " · audit trail kept"}
        </p>
      </ModalBody>
      <ModalFooter>
        <span className="font-mono text-xs text-slate-500">
          {resumable ? "Erased batches are already durable" : "This cannot be undone"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {resumable ? "Stop here" : "Close"}
          </button>
          {resumable && (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="focus-ring rounded-lg bg-danger px-4 py-2 font-mono text-sm font-semibold text-white transition hover:bg-danger/90 disabled:opacity-50"
            >
              {busy ? "Erasing…" : "Continue erasing"}
            </button>
          )}
        </div>
      </ModalFooter>
    </>
  );
}
