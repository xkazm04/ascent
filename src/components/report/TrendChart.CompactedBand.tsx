"use client";

// The COMPACTED half of the trend chart (MOONSHOT #32), split out of TrendChart.tsx to keep that
// file inside the 300-LOC rule. Pure relocation plus the compaction encoding itself: no colour is
// invented here — the hue is still `scoreHex`, and the caveat rides on the SHAPE of the mark (dashed
// stroke, hollow dot) exactly as the mock-scan encoding does.
//
// Why a compacted run is always ONE contiguous segment: the tail is appended by the reader after the
// retained scans, so in chronological order every compacted point precedes every real one. The chart
// therefore never has to stitch multiple dashed runs — and if that ever stopped being true, the
// single dashed path would visibly join the wrong points rather than fail silently.

/** Split the polyline into a dashed compacted head and a solid retained tail. */
export function trendPaths(
  points: readonly { score: number; compacted?: boolean }[],
  xFor: (i: number) => number,
  yFor: (v: number) => number,
): { dashed: string | null; solid: string | null } {
  const at = (i: number, cmd: "M" | "L") => `${cmd}${xFor(i).toFixed(1)},${yFor(points[i]!.score).toFixed(1)}`;
  const path = (from: number, to: number) => {
    if (to - from < 1) return null;
    let d = at(from, "M");
    for (let i = from + 1; i <= to; i++) d += ` ${at(i, "L")}`;
    return d;
  };
  let last = -1;
  for (let i = 0; i < points.length; i++) if (points[i]!.compacted) last = i;
  if (last < 0) return { dashed: null, solid: path(0, points.length - 1) };
  // The joining segment (last → last + 1) belongs to the DASHED run: it starts at a summarised
  // point, so drawing it solid would claim a measured slope the data does not have.
  const join = Math.min(last + 1, points.length - 1);
  return { dashed: path(0, join), solid: path(join, points.length - 1) };
}

/** The legend for the dashed run. Rendered once, and only when a compacted point is on screen. */
export function CompactedNote({ points }: { points: readonly { compacted?: boolean; scans?: number }[] }) {
  const compacted = points.filter((p) => p.compacted);
  if (compacted.length === 0) return null;
  const scans = compacted.reduce((n, p) => n + (p.scans ?? 0), 0);
  return (
    <p data-compacted-note className="mt-2 flex items-start gap-2 type-body-sm text-slate-500">
      <svg aria-hidden viewBox="0 0 24 12" className="mt-1 h-3 w-6 shrink-0">
        <line x1={0} y1={6} x2={24} y2={6} stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" />
        <circle cx={12} cy={6} r={3.5} fill="var(--color-surface-strong)" stroke="currentColor" strokeWidth={2} />
      </svg>
      <span>
        Dashed = compacted: a period average of {scans} {scans === 1 ? "scan" : "scans"} retention has since
        deleted. There is no single scan behind such a point, so it has no report permalink.
      </span>
    </p>
  );
}

/** The extra tooltip lines a compacted point carries: what it summarises, and under which rubric. */
export function CompactedTooltipLines({ point }: { point: { scans?: number; rubric?: string | null } }) {
  return (
    <div className="mt-1 type-note text-slate-400">
      <div>
        Period average of {point.scans ?? 0} {point.scans === 1 ? "scan" : "scans"} · no permalink
      </div>
      {/* Honest null: a digest folded from unstamped scans reports NO rubric rather than guessing one. */}
      <div>Rubric {point.rubric ?? "not recorded"}</div>
    </div>
  );
}
