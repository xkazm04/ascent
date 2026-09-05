import type { ScanReport } from "@/lib/types";
import { discrepancyOutcome } from "@/components/report/discrepancyOutcome";

/** Reliability caveats — surfaced above the section panels when the scan carries warnings. */
export function ReportWarnings({ warnings }: { warnings: ScanReport["warnings"] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="type-mono-sm uppercase tracking-widest text-amber-400">Heads up</div>
      <ul className="mt-2 space-y-1 type-body text-amber-200/90">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>⚠</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** AI-auditor flags: deterministic signals the auditor believes may be wrong — worth verifying.
 *  Each row states what the claim DID to the score (SAM-L1-06), derived from the same scoreIntegrity
 *  record the header chip reads, so the two surfaces cannot disagree about the same run. */
export function ReportDiscrepancies({
  discrepancies,
  integrity,
}: {
  discrepancies: ScanReport["discrepancies"];
  integrity?: ScanReport["scoreIntegrity"];
}) {
  if (discrepancies.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
      <h2 className="type-lede font-semibold text-white">Flagged for review</h2>
      <p className="mt-1 type-body text-slate-400">
        The AI auditor believes these deterministic signals may be wrong: worth verifying,
        and a useful signal for improving the detectors. Each row says what the claim did to the score.
      </p>
      <ul className="mt-3 space-y-2 type-body">
        {discrepancies.map((d, i) => {
          const outcome = discrepancyOutcome(d, integrity);
          return (
            <li key={i} className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="type-mono-sm text-amber-400">{d.dimension}</span>
              <span className="min-w-0 flex-1 text-slate-300">{d.claim}</span>
              <span
                className={`cursor-help shrink-0 rounded-full border px-2 py-0.5 type-mono-sm ${
                  outcome.acted ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-slate-700 text-slate-400"
                }`}
                title={outcome.hint}
              >
                {outcome.label}
                <span className="sr-only">. {outcome.hint}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
