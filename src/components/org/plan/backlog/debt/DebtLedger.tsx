// "The Debt Ledger" — the Backlog tab's debt summary. METAPHOR: a statement of account.
//
// AI-era debt read as a balance sheet: overdue recommendations are the PRINCIPAL (score points
// locked up), the rework rate is the INTEREST that principal accrues at (merged PRs later reverted —
// W5 revert linkage), reversion-titled PRs are WRITE-OFFS (W1a), and AI-attributed delivery is the
// EXPOSURE the interest is charged on (W2 trailers). Every number is real: the backlog half comes
// from OrgBacklog, the quality half from each repo's latest scan (org-rework.ts). Unmeasured cells
// render an honest "—" with the reason — never a zero. AI-churn share is deferred with its signal
// (see debtModel.ts header).
//
// Renders ABOVE the working BacklogPanel (grouping, bulk edit, CSV) — it aggregates to one row per
// repo and re-frames each as an account whose cost is still being paid; the panel below stays the
// place the individual items are managed.

import { Kicker } from "@/components/ui";
import { OrgTable, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { DUE_SOON_DAYS, OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { reportPermalink } from "@/lib/ui";
import type { DebtFleet } from "./debtModel";
import { fmtRate } from "./debtModel";
import { DimChips, FieldNotes, RateCell, pressureHex, unmeasuredReasonFor, verdictFor } from "./debtParts";

export function DebtLedger({ slug, fleet }: { slug: string; fleet: DebtFleet }) {
  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeader
        title="Debt ledger"
        descriptionClassName="max-w-3xl"
        description="Every repo as an account. The principal is the score points locked up in recommendations already past due; the interest rate is the share of merged PRs later reverted. High interest on a large principal is debt that compounds faster than the team pays it down."
      />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`}>
        <Tile label="Principal" value={fleet.principal} sub="pts overdue" color={fleet.principal ? OVERDUE_ACCENT : undefined} />
        <Tile label="Overdue" value={fleet.overdue} sub="recommendations" color={fleet.overdue ? OVERDUE_ACCENT : undefined} />
        <Tile label={`Due ≤ ${DUE_SOON_DAYS}d`} value={fleet.dueSoon} sub="coming due" color={fleet.dueSoon ? "#eab308" : undefined} />
        <Tile label="Interest" value={fmtRate(fleet.reworkRate)} sub="merged PRs reverted" />
        <Tile label="Write-offs" value={fmtRate(fleet.revertRate)} sub="revert-titled PRs" />
        <Tile
          label="Exposure"
          value={fmtRate(fleet.exposure)}
          sub={fleet.exposureGrounded ? "AI-trailer merges" : "AI-involved PRs"}
        />
      </div>

      <FieldNotes fleet={fleet} />

      <OrgTable
        caption="Per-repo quality debt ledger"
        minWidth={920}
        head={
          <tr className="text-left">
            <th className="px-4 py-3">Account</th>
            <th className="px-4 py-3 text-right">Principal</th>
            <th className="px-4 py-3 text-right">Age</th>
            <th className="px-4 py-3 text-right">Interest</th>
            <th className="px-4 py-3 text-right">AI interest</th>
            <th className="px-4 py-3 text-right">Write-offs</th>
            <th className="px-4 py-3 text-right">Exposure</th>
            <th className="px-4 py-3">Servicing</th>
          </tr>
        }
      >
        {fleet.rows.map((row) => {
          const v = verdictFor(row, fleet.medianRework);
          const reason = unmeasuredReasonFor(row);
          return (
            <tr key={row.repo} className="align-top">
              <td className="px-4 py-3">
                <a href={reportPermalink(row.repo, null, slug)} className="focus-ring text-base font-medium text-white hover:text-accent">
                  {row.repoName}
                </a>
                <div className="mt-1 flex items-center gap-2">
                  <DimChips dims={row.dims} />
                  {row.unowned > 0 && <span className="font-mono text-xs text-amber-300">{row.unowned} unowned</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="font-mono tabular-nums" style={{ color: row.principal ? OVERDUE_ACCENT : "#64748b" }}>
                  {row.principal || "—"}
                </div>
                <div className="font-mono text-xs tabular-nums text-slate-500">{row.overdue}/{row.active} items</div>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                {row.avgDaysOverdue ? `${row.avgDaysOverdue}d` : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                <RateCell value={row.q.reworkRate} unmeasuredReason={reason} />
              </td>
              <td className="px-4 py-3 text-right">
                <RateCell
                  value={row.q.aiReworkRate}
                  unmeasuredReason={row.q.reworkRate == null ? reason : "Fewer than 5 AI-involved merged PRs — not measurable"}
                />
              </td>
              <td className="px-4 py-3 text-right">
                <RateCell value={row.q.revertRate} unmeasuredReason={reason} />
              </td>
              <td className="px-4 py-3 text-right">
                <RateCell value={row.q.exposure} unmeasuredReason={reason} />
              </td>
              <td className="max-w-[22rem] px-4 py-3">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: pressureHex(row.pressure) }} />
                  <span className="text-sm" style={{ color: v.tone }}>
                    {v.text}
                  </span>
                </span>
                {row.oldest && (
                  <div className="mt-1 truncate font-mono text-xs text-slate-500" title={row.oldest.title}>
                    oldest: {row.oldest.title}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </OrgTable>

      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-divider pt-4">
        <Kicker tone="muted">Statement total</Kicker>
        <p className="font-mono text-sm tabular-nums text-slate-400">
          {fleet.principal} pts principal across {fleet.repos} accounts
          {fleet.reworkRate != null && <> · fleet interest {fmtRate(fleet.reworkRate)}</>}
          {fleet.aiReworkRate != null && <> ({fmtRate(fleet.aiReworkRate)} on AI-involved merges)</>}
          {fleet.worst && <> · worst account {fleet.worst.repoName}</>}
        </p>
      </div>
    </div>
  );
}
