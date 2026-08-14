import type { ScanReport } from "@/lib/types";

/** Reliability caveats — surfaced above the section panels when the scan carries warnings. */
export function ReportWarnings({ warnings }: { warnings: ScanReport["warnings"] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="font-mono text-sm uppercase tracking-widest text-amber-400">Heads up</div>
      <ul className="mt-2 space-y-1 text-base text-amber-200/90">
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

/** AI-auditor flags: deterministic signals the auditor believes may be wrong — worth verifying. */
export function ReportDiscrepancies({ discrepancies }: { discrepancies: ScanReport["discrepancies"] }) {
  if (discrepancies.length === 0) return null;
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
      <h2 className="text-lg font-semibold text-white">Flagged for review</h2>
      <p className="mt-1 text-base text-slate-400">
        The AI auditor believes these deterministic signals may be wrong: worth verifying,
        and a useful signal for improving the detectors.
      </p>
      <ul className="mt-3 space-y-2 text-base">
        {discrepancies.map((d, i) => (
          <li key={i} className="flex gap-2">
            <span className="font-mono text-sm text-amber-400">{d.dimension}</span>
            <span className="text-slate-300">{d.claim}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
