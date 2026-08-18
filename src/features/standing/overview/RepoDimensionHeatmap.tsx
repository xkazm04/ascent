"use client";

// The Repositories "Repo × dimension" heatmap, made interactive: every cell is a button that opens
// RepoDimensionModal with that repo+dimension's detail (score, evaluation, next steps), fetched on
// demand. The grid itself is still fed by the lean rollup projection ({dimId, score} per cell) — the
// rich per-dimension metadata is loaded only when a cell is clicked. Table markup mirrors the prior
// server render; only the cell-as-button + modal state are new.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Surface } from "@/components/ui";
import { SectionHeader } from "@/components/org/shared/ui";
import { DIMENSION_SHORT, heatCell, scoreHex } from "@/lib/ui";
import { RepoDimensionModal, type HeatTarget } from "@/components/org/shared/RepoDimensionModal";

export interface HeatRow {
  name: string;
  fullName: string;
  dims: { dimId: string; score: number }[];
}

/** Column mean over the repos that HAVE the dimension (a legacy scan missing a dim is excluded from
 *  that column's average rather than dragging it down as a fake 0); null when no repo has it. */
function columnAverages(rows: HeatRow[], dims: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of dims) {
    const scores = rows.map((r) => r.dims.find((x) => x.dimId === d)?.score).filter((s): s is number => s != null);
    out[d] = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  return out;
}

const dimScore = (r: HeatRow, d: string) => r.dims.find((x) => x.dimId === d)?.score;

export function RepoDimensionHeatmap({
  org,
  rows,
  dims,
  initialSortDim,
}: {
  org: string;
  rows: HeatRow[];
  dims: string[];
  /** Deep-link seed (?dim= from the Overview dimension grid): open pre-sorted weakest-first on this
   *  dimension. Ignored if it isn't a real column. */
  initialSortDim?: string;
}) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  // GC: column sort — a dimension header click ranks the fleet by that dimension, WEAKEST FIRST
  // (the actionable view: "who needs help on CI?"), a second click flips to strongest-first, a third
  // restores the caller's default (overall maturity) order. Repos missing the dim sort as -1. A
  // ?dim= deep-link seeds the same weakest-first sort so the linked-to column arrives pre-ranked.
  const [sort, setSort] = useState<{ dim: string; dir: 1 | -1 } | null>(
    initialSortDim && dims.includes(initialSortDim) ? { dim: initialSortDim, dir: 1 } : null,
  );
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => ((dimScore(a, sort.dim) ?? -1) - (dimScore(b, sort.dim) ?? -1)) * sort.dir);
  }, [rows, sort]);
  const cycleSort = (d: string) =>
    setSort((s) => (s?.dim !== d ? { dim: d, dir: 1 } : s.dir === 1 ? { dim: d, dir: -1 } : null));
  const avgs = columnAverages(rows, dims);
  return (
    <Surface className="p-5">
      <SectionHeader
        size="sm"
        title="Dimension heatmap"
        description={`Where each repo is strong or weak across all ${dims.length} dimensions. Click a column to sort, a cell for its score, evaluation, and next steps.`}
      />
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[640px]">
          <thead>
            <tr className="font-mono text-sm uppercase tracking-widest text-slate-500">
              <th className="px-2 py-1 text-left" />
              {dims.map((d) => {
                const active = sort?.dim === d;
                return (
                  <th
                    key={d}
                    scope="col"
                    aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    className="px-2 py-1 text-center"
                  >
                    <button
                      type="button"
                      onClick={() => cycleSort(d)}
                      title={`Sort by ${d}: weakest first, again for strongest, again to reset`}
                      className={`focus-ring rounded px-1 uppercase tracking-widest transition hover:text-accent ${active ? "text-accent" : ""}`}
                    >
                      {DIMENSION_SHORT[d as keyof typeof DIMENSION_SHORT] ?? d}
                      {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const byId = Object.fromEntries(r.dims.map((d) => [d.dimId, d.score]));
              return (
                <tr key={r.fullName}>
                  <th scope="row" className="px-2 py-1 text-left font-mono text-sm font-normal">
                    {/* GA: the row label opens the repo's stored report (cells stay the dim drill-in). */}
                    <Link
                      href={`/report/${r.fullName}`}
                      title={`View ${r.fullName}'s latest report`}
                      className="focus-ring text-slate-300 transition hover:text-accent"
                    >
                      {r.name}
                    </Link>
                  </th>
                  {dims.map((d) => {
                    const v = byId[d] ?? 0;
                    const cell = heatCell(v, 0.25 + (v / 100) * 0.75);
                    return (
                      <td key={d} className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: d })}
                          className="focus-ring mx-auto flex h-7 w-9 items-center justify-center rounded font-mono text-sm transition hover:ring-2 hover:ring-accent/60"
                          style={{ backgroundColor: cell.fill, color: cell.text }}
                          title={`${r.name} · ${d}: ${v} (click for detail)`}
                          aria-label={`${r.name} ${d} score ${v}, open detail`}
                        >
                          {v}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {/* GC: fleet average per column — makes the weak dimensions readable at a glance without
              scanning every row. Numbers-only (colored by score), visually set off by a top rule. */}
          <tfoot>
            <tr className="border-t border-slate-800">
              <th scope="row" className="px-2 pt-2 text-left font-mono text-xs uppercase tracking-widest text-slate-500">
                Fleet avg
              </th>
              {dims.map((d) => {
                const v = avgs[d];
                return (
                  <td key={d} className="px-1 pt-2 text-center">
                    {v == null ? (
                      <span className="font-mono text-sm text-slate-700">—</span>
                    ) : (
                      <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: scoreHex(v) }} title={`Fleet average for ${d}: ${v}`}>
                        {v}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <RepoDimensionModal org={org} target={target} onClose={() => setTarget(null)} />
    </Surface>
  );
}
