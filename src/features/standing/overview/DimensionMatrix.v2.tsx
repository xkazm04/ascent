"use client";

// v2 repo × dimension matrix: the same cells, sort and detail modal as the Altimeter heatmap (heatmapModel),
// re-expressed as spectral marks. A column header carries its dimension's hue; a cell is the score in figures,
// and its hairline bar (width = score, that dimension's hue) draws only in the sorted column and under the
// pointer. Below the green floor status travels by a glyph and a word, never by hue (the hue-versus-meaning
// ruling): hue names the dimension. An absent measurement is the void, never a zero.
import { useState } from "react";
import Link from "next/link";
import { CELL, DataTable, Frame, HEAD_CELL, SectionHead, VoidMark } from "@/components/kit";
import { RepoDimensionModal, type HeatTarget } from "@/components/org/shared/RepoDimensionModal";
import { Legend } from "@/components/org/viz";
import { DIMENSION_SHORT } from "@/lib/ui";
import { useHeatMatrix, type HeatRow } from "./heatmapModel";
import { GREEN_FLOOR } from "./phaseStanding";

const hue = (d: string) => `var(--spec-${Number(d.slice(1))})`;
const short = (d: string) => DIMENSION_SHORT[d as keyof typeof DIMENSION_SHORT] ?? d;
/** Below the floor: a leading glyph and a screen-reader word; the number itself stays paper. */
function Score({ v, className = "" }: { v: number; className?: string }) {
  const low = v < GREEN_FLOOR;
  return (
    <span className={`font-mono type-mono-sm tabular-nums text-slate-100 ${low ? "font-semibold" : ""} ${className}`}>
      {low && (
        <>
          <span aria-hidden data-role="below-floor" className="mr-1 text-[0.8em]">
            ▾
          </span>
          <span className="sr-only">below the green floor: </span>
        </>
      )}
      {v}
    </span>
  );
}

export function DimensionMatrix({ org, rows, dims, initialSortDim }: { org: string; rows: HeatRow[]; dims: string[]; initialSortDim?: string }) {
  const [target, setTarget] = useState<HeatTarget | null>(null);
  const { sort, sorted, avgs, cycleSort, hasMissing } = useHeatMatrix(rows, dims, initialSortDim);
  return (
    <Frame id="heatmap">
      <SectionHead
        eyebrow="By repository"
        title="Every repo,"
        named="on nine lines."
        lede={`${rows.length} repos × ${dims.length} dimensions. Select a dimension to rank the fleet weakest first; select a score for its detail.`}
      />
      <DataTable
        className="mt-6"
        minWidth={640}
        stickyFirstCol
        foot={
          <tr>
            <th scope="row" className={`${CELL} text-left font-normal text-slate-400`}>
              Fleet average
            </th>
            {dims.map((d) => {
              const v = avgs[d];
              return (
                <td key={d} data-sorted={sort?.dim === d || undefined} className="px-1 py-3 text-center">
                  {v == null ? (
                    <VoidMark subject={`Fleet average · ${d}`} label={`No fleet average for ${d}`} />
                  ) : (
                    <span title={`Fleet average for ${d}: ${v}`}>
                      <Score v={v} />
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        }
        caption="Repository by dimension scores"
        head={
          <tr>
            <th className={HEAD_CELL} />
            {dims.map((d) => {
              const active = sort?.dim === d;
              return (
                <th key={d} scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className="px-2 py-3 text-center font-normal">
                  <button
                    type="button"
                    onClick={() => cycleSort(d)}
                    title={`Sort by ${d}: weakest first, again for strongest, again to reset`}
                    className={`focus-ring rounded px-1 transition hover:text-white ${active ? "text-white" : ""}`}
                  >
                    <span aria-hidden data-role="matrix-hue" className="mr-1.5 inline-block h-[3px] w-3 rounded-[1px] align-middle" style={{ background: hue(d) }} />
                    {short(d)}
                    {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        }
      >
        {sorted.map((r) => {
          const byId = Object.fromEntries(r.dims.map((x) => [x.dimId, x.score]));
          return (
            <tr key={r.fullName}>
              <th scope="row" className={`${CELL} text-left font-normal`}>
                <Link href={`/report/${r.fullName}`} title={`View ${r.fullName}'s latest report`} className="focus-ring text-slate-200 transition hover:text-white">
                  {r.name}
                </Link>
              </th>
              {dims.map((d) => {
                const v = byId[d];
                if (v == null)
                  return (
                    <td key={d} data-sorted={sort?.dim === d || undefined} className="px-1 py-2 text-center">
                      <VoidMark boxed subject={`${r.name} · ${d}`} label={`${r.name} ${d}: no measurement`} />
                    </td>
                  );
                return (
                  <td key={d} data-sorted={sort?.dim === d || undefined} className="px-1 py-2">
                    <button
                      type="button"
                      onClick={() => setTarget({ fullName: r.fullName, name: r.name, dimId: d })}
                      title={`${r.name} · ${d}: ${v} (click for detail)`}
                      aria-label={`${r.name} ${d} score ${v}, open detail`}
                      data-role="matrix-cell"
                      className="focus-ring mx-auto flex w-12 flex-col items-center gap-1 rounded-[3px] px-1 py-1 transition hover:bg-white/[0.06]"
                    >
                      <Score v={v} />
                      <span aria-hidden data-role="matrix-bar" data-high={v >= 85 || undefined} className="block h-[3px] w-full rounded-[1px] bg-white/10">
                        <span className="block h-full rounded-[1px]" style={{ width: `${v}%`, background: hue(d) }} />
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </DataTable>
      <Legend states={hasMissing ? ["measured", "missing"] : []} className="mt-3" />
      <RepoDimensionModal org={org} target={target} onClose={() => setTarget(null)} />
    </Frame>
  );
}
