"use client";

// The Teams tab's dense rollup grid — one sortable row per CODEOWNERS team (maturity, AI knowledge,
// since-last-scan movement) plus a heat cell per dimension, replacing the old one-card-per-team
// stack. Clicking a team expands the row in place (TeamsMatrixDetail) to its owned repos (linked to
// their reports), champions, and mover detail, so every aggregate has a drill-down. Default order is
// the server's (most repos, then maturity); a header click re-sorts client-side (desc → asc → reset).
//
// Header cell (TeamsMatrixSortTh) and row pair (TeamsMatrixRow) are extracted siblings — this file
// held both plus the sort/expand state and stayed under the 200-LOC cap only by keeping the JSX
// itself thin.

import { useMemo, useState } from "react";
import type { TeamRollup } from "@/lib/db";
import { OrgTable, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { DIMENSION_SHORT, heatCell, scoreHex } from "@/lib/ui";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import { TeamsMatrixSortTh, type TeamsMatrixSort } from "./TeamsMatrixSortTh";
import { TeamsMatrixRow } from "./TeamsMatrixRow";

const METRIC: Record<string, (t: TeamRollup) => number> = {
  repos: (t) => t.repoCount,
  overall: (t) => t.avgOverall,
  adoption: (t) => t.avgAdoption,
  rigor: (t) => t.avgRigor,
  ai: (t) => t.aiCommitShare,
  delta: (t) => (t.comparedRepos > 0 ? t.avgDelta : Number.NEGATIVE_INFINITY),
};

function sortValue(t: TeamRollup, key: string): number {
  if (key.startsWith("dim:")) return t.dimAverages.find((d) => d.dimId === key.slice(4))?.avg ?? -1;
  return METRIC[key]?.(t) ?? 0;
}

export function TeamsMatrix({
  teams,
  dims,
  leaderSlug,
  // What the Δ column actually compares (fleet-rollups-insights 07-16 #2): the page passes the
  // selected period's comparison label when the rollup was window-scoped; the default names the
  // legacy cadence-dependent semantics honestly for windowless callers.
  deltaLabel = "since last scan",
}: {
  teams: TeamRollup[];
  dims: string[];
  leaderSlug?: string | null;
  deltaLabel?: string;
}) {
  const [sort, setSort] = useState<TeamsMatrixSort>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    if (!sort) return teams;
    return [...teams].sort((a, b) => (sortValue(b, sort.key) - sortValue(a, sort.key)) * sort.dir);
  }, [teams, sort]);

  const onSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const toggle = (slug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const scoreCell = (v: number) => (
    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: scoreHex(v) }}>
      {v}
    </td>
  );

  return (
    <OrgTable
      className="mt-3"
      minWidth={980}
      caption="Teams by maturity, AI knowledge, movement, and per-dimension averages"
      head={
        <tr>
          <th scope="col" className="px-4 py-2 text-left">Team</th>
          <TeamsMatrixSortTh id="repos" label="Repos" sort={sort} onSort={onSort} title="Sort by scanned repos owned" />
          <TeamsMatrixSortTh id="overall" label="Overall" sort={sort} onSort={onSort} />
          <TeamsMatrixSortTh id="adoption" label="Adopt" sort={sort} onSort={onSort} title="Sort by Adoption average" />
          <TeamsMatrixSortTh id="rigor" label="Rigor" sort={sort} onSort={onSort} />
          <TeamsMatrixSortTh id="ai" label="AI%" sort={sort} onSort={onSort} title="Sort by AI-attributed commit share" />
          <TeamsMatrixSortTh id="delta" label="Δ" sort={sort} onSort={onSort} title={`Sort by average movement ${deltaLabel}`} />
          {dims.map((d) => (
            <TeamsMatrixSortTh
              key={d}
              id={`dim:${d}`}
              label={DIMENSION_SHORT[d as DimensionId] ?? d}
              sort={sort}
              onSort={onSort}
              align="center"
              title={`Sort by ${DIMENSION_BY_ID[d as DimensionId]?.name ?? d}`}
            />
          ))}
        </tr>
      }
    >
      {rows.map((t) => {
        const open = expanded.has(t.slug);
        const byId = Object.fromEntries(t.dimAverages.map((d) => [d.dimId, d.avg]));
        return (
          <TeamsMatrixRow key={t.slug} team={t} open={open} onToggle={toggle} leader={t.slug === leaderSlug} colCount={7 + dims.length} deltaLabel={deltaLabel}>
            {scoreCell(t.avgOverall)}
            {scoreCell(t.avgAdoption)}
            {scoreCell(t.avgRigor)}
            {scoreCell(t.aiCommitShare)}
            <td
              className="px-2 py-2 text-right font-mono tabular-nums"
              style={{ color: t.comparedRepos > 0 ? deltaHex(t.avgDelta) : undefined }}
              title={t.comparedRepos > 0 ? `▲${t.improving} improving · ▼${t.declining} declining across ${t.comparedRepos} compared (${deltaLabel})` : "No comparable scans in this period yet"}
            >
              {t.comparedRepos > 0 ? fmtDelta(t.avgDelta) : <span className="text-slate-700">—</span>}
            </td>
            {dims.map((d) => {
              const v = byId[d];
              if (v == null) {
                return (
                  <td key={d} className="px-1 py-1.5 text-center font-mono text-sm text-slate-700" title={`${t.slug} — no ${DIMENSION_BY_ID[d as DimensionId]?.name ?? d} score yet`}>
                    ·
                  </td>
                );
              }
              const cell = heatCell(v, 0.25 + (v / 100) * 0.75);
              return (
                <td key={d} className="px-1 py-1.5">
                  <div
                    className="mx-auto flex h-7 w-9 items-center justify-center rounded font-mono text-sm"
                    style={{ backgroundColor: cell.fill, color: cell.text }}
                    title={`${t.slug} · ${DIMENSION_BY_ID[d as DimensionId]?.name ?? d}: ${v}`}
                  >
                    {v}
                  </div>
                </td>
              );
            })}
          </TeamsMatrixRow>
        );
      })}
    </OrgTable>
  );
}
