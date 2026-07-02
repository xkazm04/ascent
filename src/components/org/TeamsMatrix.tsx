"use client";

// The Teams tab's dense rollup grid — one sortable row per CODEOWNERS team (maturity, AI knowledge,
// since-last-scan movement) plus a heat cell per dimension, replacing the old one-card-per-team
// stack. Clicking a team expands the row in place (TeamsMatrixDetail) to its owned repos (linked to
// their reports), champions, and mover detail, so every aggregate has a drill-down. Default order is
// the server's (most repos, then maturity); a header click re-sorts client-side (desc → asc → reset).

import { useMemo, useState } from "react";
import type { TeamRollup } from "@/lib/db";
import { OrgTable, deltaHex, fmtDelta } from "@/components/org/ui";
import { DIMENSION_SHORT, heatCell, scoreHex } from "@/lib/ui";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import { TeamsMatrixDetail } from "@/components/org/TeamsMatrixDetail";
import { teamAnchorId } from "@/components/org/teamsShared";

type Sort = { key: string; dir: 1 | -1 } | null; // dir 1 = desc (best first)

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

function SortTh({
  id,
  label,
  sort,
  onSort,
  align = "right",
  title,
}: {
  id: string;
  label: string;
  sort: Sort;
  onSort: (key: string) => void;
  align?: "right" | "center";
  title?: string;
}) {
  const active = sort?.key === id;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "descending" : "ascending") : undefined}
      className={`px-2 py-2 ${align === "center" ? "text-center" : "text-right"}`}
    >
      <button
        type="button"
        onClick={() => onSort(id)}
        title={title ?? `Sort by ${label}`}
        className={`focus-ring rounded uppercase tracking-[0.2em] transition hover:text-white ${active ? "text-accent" : ""}`}
      >
        {label}
        {active && <span className="ml-0.5">{sort.dir === 1 ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}

export function TeamsMatrix({ teams, dims, leaderSlug }: { teams: TeamRollup[]; dims: string[]; leaderSlug?: string | null }) {
  const [sort, setSort] = useState<Sort>(null);
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
          <SortTh id="repos" label="Repos" sort={sort} onSort={onSort} title="Sort by scanned repos owned" />
          <SortTh id="overall" label="Overall" sort={sort} onSort={onSort} />
          <SortTh id="adoption" label="Adopt" sort={sort} onSort={onSort} title="Sort by Adoption average" />
          <SortTh id="rigor" label="Rigor" sort={sort} onSort={onSort} />
          <SortTh id="ai" label="AI%" sort={sort} onSort={onSort} title="Sort by AI-attributed commit share" />
          <SortTh id="delta" label="Δ" sort={sort} onSort={onSort} title="Sort by average movement since last scan" />
          {dims.map((d) => (
            <SortTh
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
          <TeamRowPair key={t.slug} team={t} open={open} onToggle={toggle} leader={t.slug === leaderSlug} colCount={7 + dims.length}>
            {scoreCell(t.avgOverall)}
            {scoreCell(t.avgAdoption)}
            {scoreCell(t.avgRigor)}
            {scoreCell(t.aiCommitShare)}
            <td
              className="px-2 py-2 text-right font-mono tabular-nums"
              style={{ color: t.comparedRepos > 0 ? deltaHex(t.avgDelta) : undefined }}
              title={t.comparedRepos > 0 ? `▲${t.improving} improving · ▼${t.declining} declining across ${t.comparedRepos} rescanned` : "No prior scan to compare yet"}
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
          </TeamRowPair>
        );
      })}
    </OrgTable>
  );
}

/** One team = a main row (team cell + repos + the metric/heat cells passed as children) and, when
 *  expanded, a full-width detail row beneath it. */
function TeamRowPair({
  team,
  open,
  onToggle,
  leader,
  colCount,
  children,
}: {
  team: TeamRollup;
  open: boolean;
  onToggle: (slug: string) => void;
  leader: boolean;
  colCount: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr id={teamAnchorId(team.slug)} className="scroll-mt-24 text-slate-300">
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={() => onToggle(team.slug)}
            aria-expanded={open}
            className="focus-ring flex items-center gap-2 rounded text-left font-mono text-sm text-white transition hover:text-accent"
          >
            <span aria-hidden className={`text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            {team.slug}
            {leader && <span title="Most institutional AI knowledge">🧠</span>}
          </button>
        </td>
        <td
          className="px-2 py-2 text-right font-mono tabular-nums text-slate-400"
          title={`${team.repoCount} scanned of ${team.totalOwned} owned · primary owner of ${team.defaultOwnerCount}`}
        >
          {team.repoCount}
          {team.totalOwned > team.repoCount && <span className="text-slate-600">/{team.totalOwned}</span>}
        </td>
        {children}
      </tr>
      {open && (
        <tr>
          <td colSpan={colCount} className="px-4 pb-4 pt-1">
            <TeamsMatrixDetail team={team} />
          </td>
        </tr>
      )}
    </>
  );
}
