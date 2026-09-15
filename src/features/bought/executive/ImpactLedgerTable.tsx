// The Impact Ledger's receipt — one row per merged improvement PR and what its post-merge rescan
// measured. Split out of ImpactLedger.tsx for the 200-LOC cap under src/features (AGENTS.md); pure
// relocation, no behavior change.
//
// This is a table on purpose (docs/ORG-UX-REDESIGN.md §2.7): auditable, row-level evidence is what a
// table is FOR. The redesign's target was the overview graphic the panel did not have, and that now
// sits above this — the funnel and the movement chart. The rows stay rows.
//
// Two column headers carry a demoted caveat as their `title`, so the rule is reachable on the column
// it governs rather than in a paragraph beneath the tiles. Server-safe — no hooks, no handlers.

import { OrgTable } from "@/components/org/shared/ui";
import type { ImpactLedger as ImpactLedgerModel } from "@/lib/db/org-impact";
import { GOOD, SOURCE_LABEL, SOURCE_TITLE, deltaCell } from "./ImpactLedgerCells";
import { IMPACT_AWAITING_HINT, IMPACT_IN_REVIEW_HINT, IMPACT_NO_BASELINE_HINT, IMPACT_NO_SUM_HINT } from "./impactView";

export function ImpactLedgerTable({ ledger }: { ledger: ImpactLedgerModel }) {
  return (
    <OrgTable
      caption="Merged improvement PRs and their measured impact"
      minWidth={760}
      head={
        <tr className="text-left">
          <th className="px-4 py-3">Repository</th>
          <th className="px-4 py-3">Bought</th>
          <th className="px-4 py-3 text-right">Dim delta</th>
          {/* (D) The rule that used to be the field notes' last sentence, on the column it governs. */}
          <th className="px-4 py-3 text-right" title={IMPACT_NO_SUM_HINT}>
            Repo overall
          </th>
          <th className="px-4 py-3" title={IMPACT_IN_REVIEW_HINT}>
            Source
          </th>
          <th className="px-4 py-3">Status</th>
        </tr>
      }
    >
      {ledger.rows.map((row) => {
        const unmeasured = row.verified ? IMPACT_NO_BASELINE_HINT : IMPACT_AWAITING_HINT;
        return (
          <tr key={`${row.repoFullName}:${row.prNumber}`} className="align-top">
            <td className="px-4 py-3">
              <a
                href={`https://github.com/${row.repoFullName}`}
                className="focus-ring type-body font-medium text-white hover:text-accent"
              >
                {row.repoName}
              </a>
              <div className="type-caption text-slate-500">{new Date(row.mergedAt).toISOString().slice(0, 10)}</div>
            </td>
            <td className="px-4 py-3">
              <a href={row.prUrl} className="focus-ring text-slate-200 hover:text-accent">
                {row.practiceLabel} <span className="type-caption text-slate-500">#{row.prNumber}</span>
              </a>
              {/* Plain slate, NOT the score ramp — the ramp means "how good is this number", and a
                  dimension id is a label, not a score. */}
              <div className="type-caption text-slate-500">{row.dimId}</div>
            </td>
            <td className="px-4 py-3 text-right">{deltaCell(row.verified ? row.impactDim : null, unmeasured)}</td>
            <td className="px-4 py-3 text-right">{deltaCell(row.verified ? row.impactOverall : null, unmeasured)}</td>
            {/* Six headers were declared and five cells emitted, so every badge sat one column left
                of its own heading: the verified/awaiting state rendered under "Source" and "Status"
                stood empty. On a receipt, a value under the wrong heading is worse than no value. */}
            <td className="px-4 py-3">
              <span className="type-label tracking-widest text-slate-400" title={SOURCE_TITLE[row.source]}>
                {SOURCE_LABEL[row.source]}
              </span>
            </td>
            <td className="px-4 py-3">
              {row.verified ? (
                <span className="type-label tracking-widest" style={{ color: GOOD }}>
                  verified
                </span>
              ) : (
                <span className="type-label tracking-widest text-amber-200">awaiting rescan</span>
              )}
            </td>
          </tr>
        );
      })}
    </OrgTable>
  );
}
