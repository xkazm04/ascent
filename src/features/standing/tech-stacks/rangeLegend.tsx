// The RangeBar's own legend rows, as the REAL marks rather than a sentence describing them.
//
// The board used to close with "hollow dot = laggard · filled dot = leader · vertical line =
// whole-fleet baseline · bar = spread" — a legend typed out in prose, under a chart, in a font the
// reader has to map back onto four 12px marks by memory. `Legend`'s `extra` slot exists for exactly
// this: each row here renders the same element the track draws, with the sentence riding along as
// the row's hover/focus hint. Server-safe (no hooks).

import type { LegendExtra } from "@/components/org/viz";

const DOT = "inline-block h-3 w-3 shrink-0 rounded-full";

export const RANGE_LEGEND_EXTRA: LegendExtra[] = [
  {
    id: "leader",
    label: "Leader",
    hint: "The highest-scoring stack on this dimension — the one the practice could transfer from.",
    swatch: <span aria-hidden className={`${DOT} bg-slate-300 ring-2 ring-ink`} />,
  },
  {
    id: "laggard",
    label: "Laggard",
    hint: "The lowest-scoring stack on this dimension — the one the transformation playbook targets.",
    swatch: <span aria-hidden className={`${DOT} border-2 border-slate-300 bg-ink`} />,
  },
  {
    id: "spread",
    label: "Spread",
    hint: "The bar spans the whole min-to-max range across the stacks the verdict rests on.",
    swatch: <span aria-hidden className="inline-block h-1.5 w-6 shrink-0 rounded-full bg-slate-500/40" />,
  },
  {
    id: "fleet",
    label: "Fleet baseline",
    hint: "The whole-fleet average for this dimension. Absent from a row when the fleet carries no average for it — a gap, not a zero.",
    swatch: <span aria-hidden className="inline-block h-4 w-px shrink-0 bg-slate-400/70" />,
  },
];
