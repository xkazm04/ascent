// VARIANT B — "Fault Lines". METAPHOR: tectonics.
//
// Two plates grind against each other: AI VELOCITY (share of merged work an assistant authored) and
// REVIEW/QUALITY CAPACITY (the org's ability to absorb it). Where velocity outruns capacity, stress
// accumulates — measured as rework and reversions — and the accumulated stress that was never
// released is exactly the overdue recommendation debt sitting on that repo. Each repo is a fault
// segment with a magnitude; the surface is read as a monitoring station, not a to-do list.
//
// How it differs from the baseline AND from variant A: this is TEMPORAL. The baseline and the ledger
// both answer "how much, right now". This answers "where is pressure building, and how fast" — every
// repo carries its own 12-week divergence trace, and rows are ranked by magnitude, not by due date.

import { Kicker } from "@/components/ui";
import { SectionEmpty, SectionHeader, Tile, TILE_LEDGER, fmtDelta, deltaHex } from "@/components/org/shared/ui";
import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { reportPermalink } from "@/lib/ui";
import type { DebtFleet, RepoDebt } from "./debtModel";
import { pct, pct1, ppDelta } from "./debtModel";
import { DebtFaultTrace, fleetSeries } from "./DebtFaultTrace";
import { DimChips, DivergenceTrace, MockNotice, PrincipalChip, TraceLegend, pressureHex } from "./debtParts";

/** Pressure 0–100 read as a seismic magnitude 0.0–5.0 — the metaphor's ranking unit. */
const magnitude = (row: RepoDebt): string => (row.pressure / 20).toFixed(1);

function FaultRow({ row, slug, median }: { row: RepoDebt; slug: string; median: number }) {
  const d = ppDelta(row.q.reworkRate, row.q.reworkRatePrev);
  const hex = pressureHex(row.pressure);
  return (
    <li className="grid grid-cols-1 gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums" style={{ color: hex }}>
            M{magnitude(row)}
          </span>
          <a href={reportPermalink(row.repo, null, slug)} className="focus-ring truncate text-base font-medium text-white hover:text-accent">
            {row.repoName}
          </a>
          <DimChips dims={row.dims} />
        </div>
        <p className="mt-1 text-sm text-slate-300">
          {row.q.aiAuthoredShare > median ? "Velocity outrunning capacity" : "Velocity within capacity"} —{" "}
          <span className="font-mono tabular-nums text-slate-200">{pct(row.q.aiAuthoredShare)}</span> AI-authored,{" "}
          <span className="font-mono tabular-nums" style={{ color: OVERDUE_ACCENT }}>
            {pct(row.q.reworkRate)}
          </span>{" "}
          reworked <span style={{ color: deltaHex(d) }}>({fmtDelta(d)} pp)</span>,{" "}
          <span className="font-mono tabular-nums text-slate-200">{pct1(row.q.reversionRate)}</span> reverted.
        </p>
        <div className="mt-1">
          <PrincipalChip row={row} />
        </div>
      </div>

      <DivergenceTrace row={row} className="justify-self-start md:justify-self-center" />

      <div className="md:w-40 md:text-right">
        <Kicker tone="muted">Accumulated slip</Kicker>
        <div className="font-mono text-xl tabular-nums" style={{ color: row.principal ? OVERDUE_ACCENT : "#64748b" }}>
          {row.principal || "—"}
          <span className="ml-1 text-xs text-slate-500">pts</span>
        </div>
        <div className="font-mono text-xs tabular-nums text-slate-500">
          {row.overdue} unreleased · {row.avgDaysOverdue}d
        </div>
      </div>
    </li>
  );
}

export function DebtFaultLines({ slug, fleet }: { slug: string; fleet: DebtFleet }) {
  const series = fleetSeries(fleet);
  const reworkDelta = ppDelta(fleet.reworkRate, fleet.reworkRatePrev);

  if (fleet.rows.length === 0) {
    return <SectionEmpty>No active recommendations to read pressure from — scan some repositories first.</SectionEmpty>;
  }

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeader
        title="Where AI velocity is outrunning your review capacity"
        descriptionClassName="max-w-3xl"
        description="Two plates: the share of merged work an assistant authored, and your ability to absorb it. Where the first outruns the second, stress shows up as rework and reversions — and the stress you never released is the overdue fix still sitting on the repo. Ranked by magnitude, not by due date."
        right={<TraceLegend />}
      />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
        <Tile label="Fleet velocity" value={pct(fleet.aiAuthoredShare)} sub="AI-authored PRs" />
        <Tile label="Stress" value={pct(fleet.reworkRate)} sub="rework rate" delta={reworkDelta} deltaLabel="pp vs prior" />
        <Tile
          label="Slips"
          value={pct1(fleet.reversionRate)}
          sub="reverted PRs"
          delta={ppDelta(fleet.reversionRate, fleet.reversionRatePrev)}
          deltaLabel="pp vs prior"
        />
        <Tile
          label="Unreleased"
          value={fleet.principal}
          sub={`pts across ${fleet.overdue} overdue`}
          color={fleet.principal ? OVERDUE_ACCENT : undefined}
        />
      </div>

      <DebtFaultTrace series={series} />
      <MockNotice />

      <div className="overflow-hidden rounded-2xl border border-divider bg-surface/40">
        <div className="border-b border-divider px-4 py-3">
          <Kicker tone="muted">Fault segments · strongest first</Kicker>
        </div>
        <ul className="divide-y divide-divider">
          {fleet.rows.map((row) => (
            <FaultRow key={row.repo} row={row} slug={slug} median={fleet.medianAiShare} />
          ))}
        </ul>
      </div>
    </div>
  );
}
