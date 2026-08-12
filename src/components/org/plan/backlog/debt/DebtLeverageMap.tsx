"use client";

// VARIANT C — "Leverage Map". METAPHOR: cartography.
//
// AI-era debt as a POSITION, not a quantity. Every repo is placed on one plane — AI-authored share
// (leverage taken) against rework rate (what that leverage costs) — sized by the overdue score points
// it owes. The plane splits at the fleet's own medians into four named territories: Leveraged,
// Compounding, Thrashing, Manual. The question it answers in one glance is the one neither the
// baseline nor a table answers: *which repos are converting AI velocity into shipped value, and
// which are converting it into debt* — with the repos to copy as visible as the repos to fix.
//
// How it differs from A and B: A aggregates (a statement), B trends (a time series). C compares —
// nothing here is ranked; position carries the whole argument, and the rail is a read-out of it.

import { useMemo, useState } from "react";
import { Kicker } from "@/components/ui";
import { SectionEmpty, SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import { reportPermalink } from "@/lib/ui";
import type { DebtFleet, RepoDebt } from "./debtModel";
import { fmtChurn, pct, pct1 } from "./debtModel";
import { DimChips, MockNotice, pressureHex, verdictFor } from "./debtParts";
import { DebtLeveragePlot, QUADRANT, quadrantOf, type QuadrantId } from "./DebtLeveragePlot";

const ORDER: QuadrantId[] = ["compounding", "thrashing", "leveraged", "manual"];

function RepoLine({ row, slug, active, medianRework }: { row: RepoDebt; slug: string; active: boolean; medianRework: number }) {
  const v = verdictFor(row, medianRework);
  return (
    <li className={`px-4 py-2.5 transition-colors ${active ? "bg-surface/80" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <a href={reportPermalink(row.repo, null, slug)} className="focus-ring truncate text-base font-medium text-white hover:text-accent">
          {row.repoName}
        </a>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-400">
          {pct(row.q.aiAuthoredShare)} AI · {pct(row.q.reworkRate)} rework
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {row.overdue > 0 && (
          <span className="font-mono text-xs tabular-nums" style={{ color: OVERDUE_ACCENT }}>
            {row.principal} pts overdue
          </span>
        )}
        <DimChips dims={row.dims} />
      </div>
      {active && <p className="mt-1 text-sm" style={{ color: v.tone }}>{v.text}</p>}
    </li>
  );
}

export function DebtLeverageMap({ slug, fleet }: { slug: string; fleet: DebtFleet }) {
  const [hover, setHover] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<QuadrantId, RepoDebt[]>(ORDER.map((q) => [q, []]));
    for (const r of fleet.rows) map.get(quadrantOf(r, fleet))!.push(r);
    return map;
  }, [fleet]);

  if (fleet.rows.length === 0) {
    return <SectionEmpty>No active recommendations to place on the map — scan some repositories first.</SectionEmpty>;
  }

  const compounding = groups.get("compounding")!;
  const compoundingPts = compounding.reduce((s, r) => s + r.principal, 0);

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeader
        title="Which repos turn AI velocity into value — and which turn it into debt"
        descriptionClassName="max-w-3xl"
        description="One plane, split at your own fleet medians. Right means more AI-authored work; down means more of it gets reworked within 30 days. Bubble size is the score points already locked up in overdue fixes. Copy the top-right; fix the bottom-right."
      />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
        {ORDER.map((q) => {
          const rows = groups.get(q)!;
          return (
            <Tile
              key={q}
              label={QUADRANT[q].label}
              value={rows.length}
              sub={`${Math.round(rows.reduce((s, r) => s + r.principal, 0) * 10) / 10} pts overdue`}
              color={rows.length ? QUADRANT[q].hex : undefined}
            />
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-divider bg-surface-strong/40 p-3">
          <DebtLeveragePlot fleet={fleet} selected={hover} onSelect={setHover} />
          <p className="mt-1 px-1 font-mono text-xs text-slate-500">
            medians · AI {pct(fleet.medianAiShare)} · rework {pct(fleet.medianRework)} · reversions {pct1(fleet.reversionRate)} ·{" "}
            {fmtChurn(fleet.rows.reduce((s, r) => s + r.q.churnPerWeek, 0))} ln/wk fleet churn
          </p>
        </div>

        <div className="space-y-3">
          {ORDER.map((q) => {
            const rows = groups.get(q)!;
            if (rows.length === 0) return null;
            return (
              <section key={q} className="overflow-hidden rounded-2xl border border-divider bg-surface/40">
                <header className="flex items-baseline justify-between gap-3 border-b border-divider px-4 py-2.5">
                  <Kicker tone="muted" className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: QUADRANT[q].hex }} />
                    {QUADRANT[q].label} · {rows.length}
                  </Kicker>
                  <span className="text-xs text-slate-500">{QUADRANT[q].blurb}</span>
                </header>
                <ul className="divide-y divide-divider">
                  {rows.map((r) => (
                    <RepoLine key={r.repo} row={r} slug={slug} active={hover === r.repo} medianRework={fleet.medianRework} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-divider pt-4">
        <Kicker tone="muted">Takeaway</Kicker>
        {compounding.length > 0 ? (
          <p className="text-base text-slate-300">
            <span className="font-mono tabular-nums" style={{ color: pressureHex(compounding[0]!.pressure) }}>
              {compounding.length}
            </span>{" "}
            {compounding.length === 1 ? "repo is" : "repos are"} compounding —{" "}
            <span className="font-mono tabular-nums" style={{ color: OVERDUE_ACCENT }}>
              {Math.round(compoundingPts * 10) / 10} pts
            </span>{" "}
            of overdue debt sitting under above-median rework. Start with{" "}
            <span className="font-medium text-white">{compounding[0]!.repoName}</span>.
          </p>
        ) : (
          <p className="text-base text-slate-300">No repo is above the fleet median on both axes — velocity is being absorbed.</p>
        )}
      </div>

      <MockNotice />
    </div>
  );
}
