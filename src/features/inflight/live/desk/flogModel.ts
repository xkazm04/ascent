// THE FLIGHT LOG'S GEOMETRY — pure, so the chart's scales are testable without a DOM. Every round is a
// column: verified closes rise above the axis, reported $ hangs below it (a dashed box when the round
// reported no cost at all — never a zero-height bar that reads as $0), one mark per lane underneath.

import type { DeskRound } from "./roundsModel";

export const FLOG = { L: 52, R: 56, top: 50, up: 150, down: 72, dotGap: 12, minW: 640 } as const;

/** Round tick values for an axis up to `max`, about `n` of them: 1, 2 or 5 × a power of ten. */
export function niceTicks(max: number, n: number): number[] {
  if (!(max > 0) || !(n > 0)) return [];
  let step = 10 ** Math.floor(Math.log10(max / n));
  const m = max / n / step;
  step *= m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
  const out: number[] = [];
  for (let v = step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface FlogGeo {
  W: number;
  H: number;
  axis: number;
  dotTop: number;
  bottom: number;
  step: number;
  bw: number;
  maxC: number;
  maxCost: number;
  x: (i: number) => number;
  yC: (v: number) => number;
  yK: (v: number) => number;
}

export function flogGeometry(rounds: readonly DeskRound[], width: number): FlogGeo {
  const { L, R, top, up, down, dotGap, minW } = FLOG;
  const W = Math.max(minW, Math.floor(width));
  const axis = top + up;
  const maxLanes = Math.max(1, ...rounds.map((r) => r.lanes.length));
  const dotTop = axis + down + 18;
  const bottom = dotTop + (maxLanes - 1) * dotGap + 30;
  const n = Math.max(1, rounds.length);
  const step = (W - L - R) / n;
  const maxC = Math.max(1, ...rounds.map((r) => r.closes));
  const maxCost = Math.max(1, ...rounds.map((r) => r.costMicros ?? 0));
  return {
    W,
    H: bottom + 4,
    axis,
    dotTop,
    bottom,
    step,
    bw: Math.max(4, Math.min(16, step * 0.62)),
    maxC,
    maxCost,
    x: (i) => L + step * i + step / 2,
    yC: (v) => axis - (v / maxC) * up,
    yK: (v) => axis + (v / maxCost) * down,
  };
}

/** The cumulative-closes polyline, scaled so the last round reaches the top line. */
export function cumulativePoints(rounds: readonly DeskRound[], g: FlogGeo, total: number): string {
  let cum = 0;
  return rounds
    .map((r, i) => {
      cum += r.closes;
      return `${g.x(i).toFixed(1)},${(g.axis - (total ? cum / total : 0) * FLOG.up).toFixed(1)}`;
    })
    .join(" ");
}

/** Which round numbers get an x-axis label: the first, every tenth, the last. */
export const tickRound = (r: DeskRound, i: number, n: number): boolean => i === 0 || i === n - 1 || (r.seq != null && r.seq % 10 === 0);
