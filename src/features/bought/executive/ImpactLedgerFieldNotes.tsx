// The Impact Ledger's field notes — the paragraph under the tiles that says exactly what the headline
// counts and what it deliberately leaves out. Split out of ImpactLedger.tsx (200-line cap).
// Server-safe — no hooks, no handlers.

import type { ImpactLedger as ImpactLedgerModel } from "@/lib/db/org-impact";

/**
 * The field notes. Names exactly what the headline counts, and — when some merges are still
 * unverified — says so in the same breath, so the number is never read as the whole story.
 */
export function FieldNotes({ ledger, periodTitle }: { ledger: ImpactLedgerModel; periodTitle: string }) {
  return (
    <p className="rounded-lg border border-dashed border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
      <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Field notes</span> Points are the{" "}
      <strong className="font-medium text-slate-200">measured</strong> delta on each PR&apos;s targeted dimension (the first
      scan after the merge against the repo&apos;s scan when the PR opened), summed over {periodTitle.toLowerCase()}. Only
      re-scanned merges count.
      {ledger.awaitingRescan > 0 && (
        <>
          {" "}
          <strong className="font-medium text-amber-200">
            {ledger.awaitingRescan} merged {ledger.awaitingRescan === 1 ? "PR is" : "PRs are"} still awaiting a rescan
          </strong>{" "}
          and contribute nothing until it lands.
        </>
      )}
      {ledger.unmeasurable > 0 && (
        <>
          {" "}
          {ledger.unmeasurable} re-scanned {ledger.unmeasurable === 1 ? "merge has" : "merges have"} no baseline scan to
          compare against (the repo was accepted before its first scan), so {ledger.unmeasurable === 1 ? "it is" : "they are"}{" "}
          shown as &ldquo;—&rdquo; rather than as zero.
        </>
      )}{" "}
      Per-repo overall movement is shown per row and never summed: one repo&apos;s overall delta added to another&apos;s has
      no meaning.
    </p>
  );
}
