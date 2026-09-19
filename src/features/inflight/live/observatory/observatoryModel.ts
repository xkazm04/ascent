// Observatory — the sky chart of the watched fleet. Pure geometry: every repo becomes a BODY placed
// in the adoption (x) × rigor (y) field the posture quadrant is already defined over
// (maturity/model.ts `postureFor`: an axis is "high" at >= POSTURE_THRESHOLD), so the picture and the
// posture label can never disagree. No React here — the layout rules are unit-testable on their own.
//
// Deliberate refusals:
//  - A repo that has never been scanned has NO coordinates. It is returned with `neverScanned: true`
//    and `x/y === null` so the accessible list can still name it while the field refuses to invent a
//    position for it.
//  - A trail point is only drawn from a history point that carries BOTH axes. A point that carries
//    neither is skipped rather than back-derived from `posture` (which would place a body at a
//    quadrant centroid it was never measured at). `RepoTrajectoryPoint` (lib/db/org-rollup.ts) now
//    selects adoption/rigor alongside overall, so the fleet history lights the trails up; the axes
//    stay OPTIONAL on the point type so any other history source degrades to no trail, not a lie.

import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import type {
  LayoutOpts,
  ObservatoryBody,
  ObservatoryHistory,
  ObservatoryHistoryPoint,
  ObservatorySeed,
  TrailPoint,
} from "./observatoryTypes";

export { isPlotted } from "./observatoryTypes";
export type {
  LayoutOpts,
  ObservatoryBody,
  ObservatoryHistory,
  ObservatoryHistoryPoint,
  ObservatoryScope,
  ObservatorySeed,
  PlottedBody,
  TrailPoint,
} from "./observatoryTypes";

/** Axis score at or above which an axis reads "high" — mirrors maturity/model.ts POSTURE_THRESHOLD. */
export const OBSERVATORY_THRESHOLD = 50;

/** SVG frame the 0–100 data space is projected into (viewBox units). */
export const FIELD = { w: 1000, h: 620, left: 64, right: 24, top: 24, bottom: 48 } as const;

export const projectX = (x: number): number => FIELD.left + (x / 100) * (FIELD.w - FIELD.left - FIELD.right);
/** y is inverted: rigor 100 sits at the TOP of the frame. */
export const projectY = (y: number): number => FIELD.top + (1 - y / 100) * (FIELD.h - FIELD.top - FIELD.bottom);

export type QuadrantId = "compounding" | "adoption-heavy" | "rigor-heavy" | "laggards";

/** Muted quadrant captions, keyed to the posture they correspond to. */
export const QUADRANT_LABEL: Record<QuadrantId, string> = {
  compounding: "Compounding",
  "adoption-heavy": "Adoption-heavy",
  "rigor-heavy": "Rigor-heavy",
  laggards: "Laggards",
};

/** The posture id each quadrant is the geometric twin of (postureFor's four cases). */
export const QUADRANT_POSTURE: Record<QuadrantId, string> = {
  compounding: "ai-native",
  "adoption-heavy": "ungoverned",
  "rigor-heavy": "manual",
  laggards: "early",
};

export function quadrantOf(point: { x: number | null; y: number | null }): QuadrantId | null {
  if (point.x == null || point.y == null) return null;
  const a = point.x >= OBSERVATORY_THRESHOLD;
  const r = point.y >= OBSERVATORY_THRESHOLD;
  if (a && r) return "compounding";
  if (a) return "adoption-heavy";
  if (r) return "rigor-heavy";
  return "laggards";
}

/**
 * The AI-Native frontier. It is NOT a diagonal line: `postureFor` requires BOTH axes over the
 * threshold, so the boundary of the AI-Native quadrant is the L-shaped corner at (50, 50) — a
 * vertical run up the adoption cut and a horizontal run along the rigor cut. Returning the two
 * segments (rather than one line) keeps the drawing honest about the real rule.
 */
export function frontier(opts?: { threshold?: number }): {
  threshold: number;
  corner: { x: number; y: number };
  segments: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
} {
  const t = opts?.threshold ?? OBSERVATORY_THRESHOLD;
  return {
    threshold: t,
    corner: { x: t, y: t },
    segments: [
      { x1: t, y1: t, x2: t, y2: 100 },
      { x1: t, y1: t, x2: 100, y2: t },
    ],
  };
}

const finite = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/** Level ramp colour: the L1–L5 id when the seed carries one, else the score's own band. */
function fillFor(level: string | null, overall: number | null): string {
  if (level && /^L[1-5]$/.test(level)) return LEVEL_HEX[level as keyof typeof LEVEL_HEX];
  return overall == null ? LEVEL_HEX.L1 : scoreHex(overall);
}

function radiusFor(volume: number | null, maxVolume: number, o: Required<Pick<LayoutOpts, "rMin" | "rMax" | "rDefault">>) {
  if (volume == null || maxVolume <= 0) return o.rDefault;
  // sqrt so AREA, not radius, tracks volume — a 4× busier repo reads as 4× the ink, not 16×.
  return o.rMin + (o.rMax - o.rMin) * Math.sqrt(Math.max(0, volume) / maxVolume);
}

function trailFor(points: ObservatoryHistoryPoint[], at: { x: number; y: number }, max: number): TrailPoint[] {
  const usable: TrailPoint[] = [];
  for (const p of points) {
    const a = finite(p.adoption);
    const r = finite(p.rigor);
    if (a == null || r == null) continue;
    usable.push({ x: clamp100(a), y: clamp100(r), at: p.at });
  }
  const last = usable[usable.length - 1];
  if (last && last.x === at.x && last.y === at.y) usable.pop();
  return usable.slice(-max);
}

/**
 * Place every seed in the field. Output order is the input order (deterministic); the caller decides
 * paint order. Bodies with no adoption/rigor pair are returned unplotted, never guessed.
 */
export function layoutBodies(
  seeds: readonly ObservatorySeed[],
  histories: readonly ObservatoryHistory[] = [],
  opts: LayoutOpts = {},
): ObservatoryBody[] {
  const { rMin = 7, rMax = 20, rDefault = 10, maxTrail = 3, volumes } = opts;
  const byRepo = new Map(histories.map((h) => [h.fullName, h.points]));
  const maxVolume = volumes ? Math.max(0, ...seeds.map((s) => volumes[s.fullName] ?? 0)) : 0;

  return seeds.map((s) => {
    const a = finite(s.adoption);
    const r = finite(s.rigor);
    const plotted = a != null && r != null;
    const x = plotted ? clamp100(a) : null;
    const y = plotted ? clamp100(r) : null;
    const overall = finite(s.overall);
    return {
      kind: "body" as const,
      fullName: s.fullName,
      name: s.name,
      label: s.name || s.fullName,
      x,
      y,
      r: radiusFor(volumes ? volumes[s.fullName] ?? null : null, maxVolume, { rMin, rMax, rDefault }),
      level: s.level ?? null,
      overall,
      adoption: a,
      rigor: r,
      fill: fillFor(s.level ?? null, overall),
      posture: s.posture ?? null,
      quadrant: quadrantOf({ x, y }),
      trail: plotted ? trailFor(byRepo.get(s.fullName) ?? [], { x: x!, y: y! }, maxTrail) : [],
      lastScannedAt: s.scannedAt ?? null,
      neverScanned: !plotted,
    };
  });
}
