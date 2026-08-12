// VARIANT A — "The Debt Ledger". METAPHOR: a statement of account.
//
// AI-era debt read as a balance sheet: overdue recommendations are the PRINCIPAL (score points
// locked up), the rework rate is the INTEREST RATE that principal accrues at, reversions are
// WRITE-OFFS, and AI-authored churn is the EXPOSURE the interest is charged on. Editorial, dense,
// single column, mono-typeset — a document you read top to bottom and could hand to a VP.
//
// How it differs from the baseline: the baseline groups the SAME recommendations by owner/due date
// as a to-do list. This never lists an item. It aggregates to one row per repo and re-frames each
// row as an account whose cost is still being paid.

import { Dateline, Kicker } from "@/components/ui";
import { OrgTable, SectionHeader, Tile, TILE_LEDGER, fmtDelta, deltaHex } from "@/components/org/shared/ui";
import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { reportPermalink } from "@/lib/ui";
import type { DebtFleet } from "./debtModel";
import { fmtChurn, pct, pct1, ppDelta } from "./debtModel";
import { DimChips, MockNotice, RateCell, pressureHex, verdictFor } from "./debtParts";

export function DebtLedger({ slug, fleet }: { slug: string; fleet: DebtFleet }) {
  const reworkDelta = ppDelta(fleet.reworkRate, fleet.reworkRatePrev);
  const reversionDelta = ppDelta(fleet.reversionRate, fleet.reversionRatePrev);

  return (
    <div className="animate-fade-up space-y-5">
      <Dateline
        left={`Debt ledger · ${slug}`}
        right={`${fleet.repos} accounts · ${fleet.overdue} overdue · statement of quality debt`}
      />

      <SectionHeader
        title="What AI velocity is costing you"
        descriptionClassName="max-w-3xl"
        description="Every repo as an account. The principal is the score points locked up in recommendations already past due; the interest rate is the share of merged changes reworked within 30 days. High interest on a large principal is debt that compounds faster than the team pays it down."
      />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`}>
        <Tile label="Principal" value={fleet.principal} sub="pts overdue" color={fleet.principal ? OVERDUE_ACCENT : undefined} />
        <Tile label="Overdue" value={fleet.overdue} sub="recommendations" color={fleet.overdue ? OVERDUE_ACCENT : undefined} />
        <Tile label="Interest" value={pct(fleet.reworkRate)} sub="rework rate" delta={reworkDelta} deltaLabel="pp vs prior" />
        <Tile label="Write-offs" value={pct1(fleet.reversionRate)} sub="reverted PRs" delta={reversionDelta} deltaLabel="pp vs prior" />
        <Tile label="Exposure" value={pct(fleet.aiAuthoredShare)} sub="AI-authored PRs" />
        <Tile label="Unowned" value={fleet.unowned} sub="no assignee" color={fleet.unowned ? "#fbbf24" : undefined} />
      </div>

      <MockNotice />

      <OrgTable
        caption="Per-repo quality debt ledger"
        minWidth={920}
        head={
          <tr className="text-left">
            <th className="px-4 py-3">Account</th>
            <th className="px-4 py-3 text-right">Principal</th>
            <th className="px-4 py-3 text-right">Age</th>
            <th className="px-4 py-3 text-right">Interest</th>
            <th className="px-4 py-3 text-right">Write-offs</th>
            <th className="px-4 py-3 text-right">Exposure</th>
            <th className="px-4 py-3">Servicing</th>
          </tr>
        }
      >
        {fleet.rows.map((row) => {
          const v = verdictFor(row, fleet.medianRework);
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
              <td className="px-4 py-3">
                <div className="flex justify-end">
                  <RateCell now={row.q.reworkRate} prev={row.q.reworkRatePrev} />
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end">
                  <RateCell now={row.q.reversionRate} prev={row.q.reversionRatePrev} decimals={1} />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="font-mono tabular-nums text-slate-200">{pct(row.q.aiChurnShare)}</div>
                <div className="font-mono text-xs tabular-nums text-slate-500">{fmtChurn(row.q.churnPerWeek)} ln/wk</div>
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
          {fleet.principal} pts principal across {fleet.repos} accounts · interest{" "}
          <span style={{ color: deltaHex(reworkDelta) }}>{fmtDelta(reworkDelta)} pp</span> this period
          {fleet.worst && <> · worst account {fleet.worst.repoName}</>}
        </p>
      </div>
    </div>
  );
}
