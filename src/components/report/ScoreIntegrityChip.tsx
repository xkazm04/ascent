import type { ScanReport } from "@/lib/types";
import { integrityNotes } from "@/lib/maturity/attribution";

/**
 * The report header's SCORE-INTEGRITY chip: what fired while scoring that could move this headline on
 * an UNCHANGED commit — D9 renormalized out, a widened (or capped) guardband, a coverage-reduced
 * blend.
 *
 * The record behind it (`report.scoreIntegrity`) has existed and been typed for months and was
 * rendered by nothing (UAT `SAM-L1-02`, 2026-08-10), which is precisely why a reader comparing two
 * reports had no way to tell a repository change from a scoring one. Deliberately absent on a clean
 * run: a chip reading "integrity: fine" on every report is noise, and the affordance only earns its
 * place when it has something to disclose. Absent too when the field is undefined — a reconstructed
 * row from before the column is UNKNOWN, and unknown is not a finding.
 *
 * Co-located rather than inlined into ReportHeader so that file stays near its size budget, and so
 * the summary comes from the same `integrityNotes` the cockpit ledger uses — one record, one wording.
 */
export function ScoreIntegrityChip({ report }: { report: ScanReport }) {
  const notes = integrityNotes(report.scoreIntegrity);
  if (notes.length === 0) return null;

  const hint = `Scoring integrity — what moved this score independently of the repository: ${notes
    .map((n) => n.hint)
    .join(" ")}`;

  return (
    <span
      className="cursor-help rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300"
      title={hint}
      data-testid="score-integrity-chip"
    >
      integrity · {notes.map((n) => n.label).join(" · ")}
      <span className="sr-only">. {hint}</span>
    </span>
  );
}
