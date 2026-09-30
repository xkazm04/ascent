// Trend domain: the y-range a maturity trend is drawn against. Not the data's own min and max (that autoscales a
// wobble into a cliff) but the LEVEL BANDS the data touches, padded one band each side, so the axis is a fixed
// ruler the reader already knows and a two-point move inside one band looks like what it is.
import { LEVELS } from "@/lib/maturity/model";

export interface TrendEdge {
  /** Score at the band's lower edge. */
  at: number;
  /** Level id of the band that STARTS at this edge ("L3"). */
  level: string;
}

export interface TrendDomain {
  lo: number;
  hi: number;
  /** Band edges inside [lo, hi], lowest first, `lo` included. */
  edges: TrendEdge[];
}

const bandIndex = (v: number) => {
  const i = LEVELS.findIndex((l) => v >= l.band[0] && v <= l.band[1]);
  return i < 0 ? (v < 0 ? 0 : LEVELS.length - 1) : i;
};

/** Domain for a score series: bands touched, padded one band, clamped to the model's ladder. */
export function bandDomain(values: readonly number[]): TrendDomain {
  const finite = values.filter((v) => Number.isFinite(v));
  const a = bandIndex(finite.length ? Math.min(...finite) : 0);
  const b = bandIndex(finite.length ? Math.max(...finite) : 0);
  const lo = Math.max(0, a - 1);
  const hi = Math.min(LEVELS.length - 1, b + 1);
  return {
    lo: LEVELS[lo]!.band[0],
    hi: LEVELS[hi]!.band[1],
    edges: LEVELS.slice(lo, hi + 1).map((l) => ({ at: l.band[0], level: l.id })),
  };
}
