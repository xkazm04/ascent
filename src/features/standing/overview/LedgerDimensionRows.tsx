"use client";

// The dimension section as an editorial LEDGER: one full-width line item per dimension, grouped
// under SDLC-phase rules. Every row carries the four things the old grid left out: a status word
// (Weak · Emerging · …), a one-line reading (rank · repos below green · movement), and TWO named
// affordances that say where they go — "Practice → <name>" and "▦ <n> repos" — instead of a bare
// label that silently linked to a practice card.
//
// The metaphor is a balance sheet: rules between phases, mono figures right-aligned, one glance to
// see which phase of the pipeline is carrying the debt.
//
// COLUMN ALIGNMENT. Each row is its own CSS grid (a phase rule sits between row groups, so one grid
// over the whole ledger would need subgrid), which means every track must resolve to the SAME width
// on every row from the track list alone — never from that row's content. So: fixed rem widths for
// every column whose content varies (name, score, delta, the two affordances), and `fr` only for the
// meter and the reading, whose share of the remaining width is identical row to row. The first cut
// used `auto` for the affordances and `minmax(7rem, 9rem)` for the name, and both resolved per row:
// a long practice label pushed that row's meter and score left of its neighbours'.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { buildUrl, clearedTabScopedParams, orgTabHref } from "@/lib/org/orgTabs";
import { deltaHex } from "@/components/ui/format";
import { scoreHex } from "@/lib/ui";
import { groupByPhase, type DimensionReading } from "./dimensionReading";

// name · meter · score · delta · reading · practice · heatmap
const ROW_COLS = "grid-cols-[8.5rem_minmax(5rem,1fr)_2.75rem_2.75rem_minmax(0,2fr)_15rem_5.5rem]";

export function LedgerDimensionRows({
  slug,
  readings,
  search,
}: {
  slug: string;
  readings: DimensionReading[];
  search: string;
}) {
  const groups = groupByPhase(readings);
  return (
    <div className="mt-4 overflow-x-auto">
      <div className="min-w-[56rem] overflow-hidden rounded-xl border border-divider">
        {groups.map((g, gi) => (
          <section key={g.phase.id} className={gi > 0 ? "border-t border-divider" : ""}>
            {/* Phase rule: kicker + the question the phase answers + the phase's own average. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-surface/60 px-4 py-2">
              <div className="flex items-baseline gap-3">
                <Kicker tone="accent">{g.phase.label}</Kicker>
                <span className="text-sm text-slate-500">{g.phase.question}</span>
              </div>
              {g.avg !== null && (
                <span className="font-mono text-sm tabular-nums text-slate-400">
                  phase avg{" "}
                  <span className="font-semibold" style={{ color: scoreHex(g.avg) }}>
                    {g.avg}
                  </span>
                </span>
              )}
            </div>
            {g.rows.map((r) => (
              <LedgerRow key={r.dimId} r={r} slug={slug} search={search} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function LedgerRow({ r, slug, search }: { r: DimensionReading; slug: string; search: string }) {
  const color = scoreHex(r.avg);
  const heatHref = `${buildUrl(slug, { ...clearedTabScopedParams(), dim: r.dimId }, search)}#heatmap`;
  return (
    <div className={`grid ${ROW_COLS} items-center gap-x-4 border-t border-divider px-4 py-2 text-sm first:border-t-0 hover:bg-surface/40`}>
      {/* name + status word */}
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-100">{r.short}</div>
        <div className="font-mono text-xs uppercase tracking-widest" style={{ color }}>
          {r.status}
        </div>
      </div>
      <Meter value={r.avg} color={color} />
      <span className="text-right font-mono text-base font-semibold tabular-nums" style={{ color }}>
        {r.avg}
      </span>
      <span
        className="text-right font-mono text-xs tabular-nums"
        style={{ color: r.delta === null ? "var(--color-divider)" : r.delta === 0 ? undefined : deltaHex(r.delta) }}
        title={r.delta === null ? "No baseline in this window" : undefined}
      >
        {r.delta === null ? "—" : r.delta === 0 ? "·" : `${r.delta > 0 ? "▲" : "▼"}${Math.abs(r.delta)}`}
      </span>
      {/* the reading */}
      <span className="min-w-0 truncate text-slate-400" title={r.note}>
        {r.note || <span className="text-slate-600">no repos scored on this dimension</span>}
      </span>
      {/* named affordances — a reader knows what a click does BEFORE clicking. Fixed-width cells;
          the practice label truncates inside its cell rather than pushing the row. */}
      {r.practice ? (
        <Link
          href={`${orgTabHref(slug, "practices")}#practice-${r.practice.id}`}
          className="focus-ring min-w-0 truncate rounded font-mono text-xs text-slate-400 transition hover:text-accent"
          title={`Open the practice that lifts ${r.short}: ${r.practice.label}`}
        >
          Practice → <span className="text-slate-200">{shortLabel(r.practice.label)}</span>
        </Link>
      ) : (
        <span className="font-mono text-xs text-slate-600">no practice yet</span>
      )}
      <Link
        href={heatHref}
        className="focus-ring justify-self-end whitespace-nowrap rounded font-mono text-xs text-slate-400 transition hover:text-accent"
        title={`Jump to the heatmap sorted weakest-first on ${r.short}`}
      >
        ▦ {r.belowGreen.of} repo{r.belowGreen.of === 1 ? "" : "s"}
      </Link>
    </div>
  );
}

/** "Agent guidance (CLAUDE.md / AGENTS.md)" → "Agent guidance": the parenthetical is detail for the
 *  practice card, not for a link label. */
function shortLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "");
}
