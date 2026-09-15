"use client";

// The Teams tab's rollup surface: a per-dimension HEAT MATRIX above a sortable scalar table.
//
// The dimension columns used to live in the table as a numeric grid — one tinted box per team per
// dimension, and a bare "·" wherever a team had never been scored on one, distinguishable from a low
// score only by hovering it. That is a picture drawn out of numerals, and the void in it was the
// least legible mark on the page. `MatrixGrid` (the shared kit) draws the same data as a matrix and
// HATCHES the unjudged cell, where `rendersValue` makes printing a numeral structurally impossible.
// The table keeps what a table is right for (§2.7): auditable row-level scalars with a drill-down.
//
// The matrix follows the table's sort, so the two are one surface and not two.
//
// Header cell (TeamsMatrixSortTh) and row pair (TeamsMatrixRow) are extracted siblings; the matrix's
// own view model is the pure `teamsViz.ts`.

import { useMemo, useState } from "react";
import type { TeamRollup } from "@/lib/db";
import { OrgTable, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { Legend, MatrixGrid, StateSwatch, stateTitle } from "@/components/org/viz";
import { TeamsMatrixSortTh, type TeamsMatrixSort } from "./TeamsMatrixSortTh";
import { TeamsMatrixRow } from "./TeamsMatrixRow";
import { dimMatrixRows, dimMatrixStates, unjudgedCellCount } from "./teamsViz";

const METRIC: Record<string, (t: TeamRollup) => number> = {
  repos: (t) => t.repoCount,
  overall: (t) => t.avgOverall,
  adoption: (t) => t.avgAdoption,
  rigor: (t) => t.avgRigor,
  // A team with no commit population sorts BELOW every reading rather than among the zeroes: it is
  // not the least AI-native team, it is a team with no AI-share reading at all.
  ai: (t) => t.aiCommitShare ?? Number.NEGATIVE_INFINITY,
  delta: (t) => (t.comparedRepos > 0 ? t.avgDelta : Number.NEGATIVE_INFINITY),
};

function sortValue(t: TeamRollup, key: string): number {
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

  const matrix = useMemo(() => dimMatrixRows(rows, dims), [rows, dims]);
  const unjudged = unjudgedCellCount(matrix);

  const onSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const toggle = (slug: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  // The AI% cell is a commit-weighted SHARE; the row printed it bare, so the only place a reader
  // could learn how many people it rests on was the expanded detail. A team of two with one AI user
  // and a team of forty read identically at "50". The population now rides the cell itself.
  const aiCell = (t: TeamRollup) =>
    // NULL is not a zero. `rollupTeams` returns null when the team's repos were scanned without
    // commit history, and this cell used to paint that with `scoreHex(0)` — alarm red, reading "0",
    // pixel-identical to a team measured at a genuine 0% across five hundred commits. The hatched
    // swatch is the kit's `not-judged`, and it prints no numeral at all.
    t.aiCommitShare === null ? (
      <td className="px-2 py-2" title={stateTitle("not-judged", `${t.slug} · AI commit share`)}>
        <span className="flex items-center justify-end">
          <StateSwatch state="not-judged" size={12} />
        </span>
      </td>
    ) : (
      <td
        className="px-2 py-2 text-right font-mono tabular-nums"
        style={{ color: scoreHex(t.aiCommitShare) }}
        title={`${t.aiCommitShare}% of this team's commits are AI-attributed · ${t.aiContributors} of ${t.contributors} contributor${t.contributors === 1 ? " has" : "s have"} at least one AI-attributed commit`}
      >
        {t.aiCommitShare}
        <span className="ml-1 type-micro text-slate-600">
          {t.aiContributors}/{t.contributors}
        </span>
      </td>
    );

  const scoreCell = (v: number) => (
    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: scoreHex(v) }}>
      {v}
    </td>
  );

  return (
    <div>
      {dims.length > 0 && (
        <div className="mt-3">
          <MatrixGrid
            axes={dims.map((d) => DIMENSION_SHORT[d as DimensionId] ?? d)}
            rows={matrix}
            title="Teams by dimension"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <Legend states={dimMatrixStates(matrix)} />
            {unjudged > 0 && (
              <span className="type-mono-sm text-slate-600">
                {unjudged} team-dimension pair{unjudged === 1 ? "" : "s"} never scored
              </span>
            )}
          </div>
        </div>
      )}

      <OrgTable
        className="mt-5"
        minWidth={620}
        caption="Teams by maturity, AI knowledge and movement — one row per CODEOWNERS team, expandable to its repos and champions"
        head={
          <tr>
            <th scope="col" className="px-4 py-2 text-left">Team</th>
            <TeamsMatrixSortTh id="repos" label="Repos" sort={sort} onSort={onSort} title="Sort by scanned repos owned" />
            <TeamsMatrixSortTh id="overall" label="Overall" sort={sort} onSort={onSort} />
            <TeamsMatrixSortTh id="adoption" label="Adopt" sort={sort} onSort={onSort} title="Sort by Adoption average" />
            <TeamsMatrixSortTh id="rigor" label="Rigor" sort={sort} onSort={onSort} />
            <TeamsMatrixSortTh id="ai" label="AI%" sort={sort} onSort={onSort} title="Sort by AI-attributed commit share" />
            <TeamsMatrixSortTh id="delta" label="Δ" sort={sort} onSort={onSort} title={`Sort by average movement ${deltaLabel}`} />
          </tr>
        }
      >
        {rows.map((t) => {
          const open = expanded.has(t.slug);
          return (
            <TeamsMatrixRow key={t.slug} team={t} open={open} onToggle={toggle} leader={t.slug === leaderSlug} colCount={7} deltaLabel={deltaLabel}>
              {scoreCell(t.avgOverall)}
              {scoreCell(t.avgAdoption)}
              {scoreCell(t.avgRigor)}
              {aiCell(t)}
              <td
                className="px-2 py-2 text-right font-mono tabular-nums"
                style={{ color: t.comparedRepos > 0 ? deltaHex(t.avgDelta) : undefined }}
                title={
                  t.comparedRepos > 0
                    ? `▲${t.improving} improving · ▼${t.declining} declining across ${t.comparedRepos} compared (${deltaLabel})`
                    : stateTitle("missing", `${t.slug} · movement ${deltaLabel}`)
                }
              >
                {t.comparedRepos > 0 ? (
                  fmtDelta(t.avgDelta)
                ) : (
                  // No comparable pair in this period is an ABSENCE, and an em dash in a column of
                  // numbers is the glyph the redesign exists to stop reading as a zero.
                  <span className="inline-flex align-middle">
                    <StateSwatch state="missing" size={12} />
                  </span>
                )}
              </td>
            </TeamsMatrixRow>
          );
        })}
      </OrgTable>
    </div>
  );
}
