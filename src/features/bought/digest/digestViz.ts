// The weekly digest's view models — every scale and every epistemic state, decided HERE.
//
// The digest is the one org surface that also LEAVES the product (markdown, Slack, a board PDF), so
// its screen rendering and its pasted form have to agree about what was measured and what was not.
// Deciding in a pure module means a chart and its generated `sr-only` table are built from one
// answer, and the refusals are testable without a DOM — the Wave 1 pattern (leverageMoves.ts).
//
// The rule this file enforces: `band === "unmeasured"` maps to the kit's `missing` state, whose
// `rendersValue()` is false. A dimension the window could not measure therefore CANNOT print a
// numeral — "an em dash is a missing measurement, not a zero" stops being a promise the reader has
// to hold and becomes a shape the code cannot draw wrong.

import { isNum, type VizState } from "@/components/org/viz";
import { SCORE_NOISE_BAND } from "@/lib/maturity/noise";
import type {
  DigestAction,
  DigestBand,
  DigestDimDelta,
  DigestFollowups,
  DigestHeadline,
  DigestMovement,
} from "@/lib/org/digest-types";

/** Half-width of the drawn noise band, in score points — the canonical one, never a local constant. */
export const NOISE = SCORE_NOISE_BAND;

/** The presentation band → the shared epistemic state. `flat` is deliberately **measured**, not a
 *  third state: a within-noise hold IS a measurement, and the reason it is not movement is that it
 *  lands inside the drawn band. Encoding that twice lets the two copies disagree. */
export function bandState(band: DigestBand): VizState {
  return band === "unmeasured" ? "missing" : "measured";
}

/** Symmetric half-extent for a delta axis: never tighter than the noise band plus a margin, so the
 *  band is always visible as a band rather than filling the lane. */
export function deltaExtent(deltas: readonly (number | null)[]): number {
  const max = deltas.reduce<number>((m, d) => (isNum(d) ? Math.max(m, Math.abs(d)) : m), 0);
  return Math.max(NOISE + 2, Math.ceil(max));
}

/** Distinct states in first-seen order — what `Legend` wants (only the states actually present). */
export function presentStates(states: readonly VizState[]): VizState[] {
  const seen = new Set<VizState>();
  return states.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
}

// ── dimensions ────────────────────────────────────────────────────────────────

export interface DimBar {
  dimId: string;
  label: string;
  /** The dimension's current fleet average — always a measurement (it comes from `dimAverages`). */
  now: number;
  /** The week's cohort-matched move, or null when the window could not measure one. */
  delta: number | null;
  state: VizState;
  /** True for a measured move that lands inside the band: a hold, not a climb. */
  withinNoise: boolean;
}

export function dimBars(dims: readonly DigestDimDelta[]): DimBar[] {
  return dims.map((d) => ({
    dimId: d.dimId,
    label: d.label,
    now: d.now,
    delta: d.band === "unmeasured" ? null : d.delta,
    state: bandState(d.band),
    withinNoise: d.band === "flat",
  }));
}

// ── follow-up ledger ──────────────────────────────────────────────────────────

export interface LedgerBar {
  id: string;
  label: string;
  /** Null only where the count does not exist as a measurement — never a stand-in zero. */
  count: number | null;
  state: VizState;
}

export interface LedgerView {
  closed: LedgerBar;
  /** A SEPARATE segment, never summed into `closed`: a dismissal is a decision not to do the work. */
  dismissed: LedgerBar;
  opened: LedgerBar;
  /** Shared count axis for both tracks, so the two bars are comparable at a glance. */
  max: number;
  unmeasuredRepos: number;
  openedMeasurable: boolean;
}

export function ledgerView(f: DigestFollowups): LedgerView {
  const openedCount = f.openedMeasurable ? f.opened : null;
  return {
    closed: { id: "closed", label: "Closed", count: f.closed, state: "measured" },
    // `decided`: the kit's accent ring is "a person decided this". A dismissal is exactly that — a
    // human call that the work will not be done — which is why it is drawn beside the closes and
    // never inside them. A leadership update that folds it in claims credit for a decision to stop.
    dismissed: { id: "dismissed", label: "Dismissed", count: f.dismissed, state: "decided" },
    opened: {
      id: "opened",
      label: "Opened",
      count: openedCount,
      // No repo had a pre-window scan, so the identity diff has nothing to compare: `missing`, whose
      // `rendersValue` is false. The 0 that would otherwise read as "a calm week" is unprintable.
      state: f.openedMeasurable ? "measured" : "missing",
    },
    max: Math.max(1, f.closed + f.dismissed, openedCount ?? 0),
    unmeasuredRepos: f.unmeasuredRepos,
    openedMeasurable: f.openedMeasurable,
  };
}

// ── next actions ──────────────────────────────────────────────────────────────

export interface ActionBar {
  rank: number;
  title: string;
  dimId: string;
  dimLabel: string;
  /** Repos carrying this gap — the move's reach, an exact count. */
  repoCount: number;
  /** Of those, the repos the move would push up a maturity level. */
  lifts: number;
  /** Mean projected points per affected repo, or null where no repo had persisted dimensions. */
  perRepo: number | null;
  /** `missing` when there is no projection: the bar draws its reach, and prints no points at all. */
  pointsState: VizState;
}

export function actionBars(actions: readonly DigestAction[]): { bars: ActionBar[]; maxRepos: number } {
  const bars = actions.map((a) => ({
    rank: a.rank,
    title: a.title,
    dimId: a.dimId,
    dimLabel: a.dimLabel,
    repoCount: a.repoCount,
    // A move cannot lift more repos than it reaches; a bad row must not draw a segment past its bar.
    lifts: Math.max(0, Math.min(a.repoCount, a.liftsRepos)),
    perRepo: isNum(a.projectedPoints) ? a.projectedPoints : null,
    pointsState: (isNum(a.projectedPoints) ? "measured" : "missing") as VizState,
  }));
  return { bars, maxRepos: Math.max(1, ...bars.map((b) => b.repoCount)) };
}

// ── headline coverage ─────────────────────────────────────────────────────────

export interface CoverageView {
  total: number;
  scanned: number;
  /** Repos scanned on BOTH sides of the week — the denominator every headline delta is measured over. */
  cohort: number | null;
  cohortState: VizState;
  onboarded: number;
  departed: number;
  /** Repos with no scan at all: never assessed, not repos that scored nothing. */
  neverScanned: number;
}

export function coverageView(h: DigestHeadline): CoverageView {
  const total = Math.max(h.total, h.scanned);
  return {
    total,
    scanned: h.scanned,
    cohort: h.cohortSize,
    // No baseline at all → the comparison cohort is an absence, drawn as a void bracket with no count.
    cohortState: h.cohortSize == null ? "missing" : "measured",
    onboarded: h.onboarded,
    departed: h.departed,
    neverScanned: Math.max(0, total - h.scanned),
  };
}

// ── repository movement ───────────────────────────────────────────────────────

export interface MoveMark {
  key: string;
  name: string;
  fullName?: string;
  d: number;
  from: string;
  to: string;
  /** The move also carried the repo across a maturity level edge — a different fact from its size. */
  crossedLevel: boolean;
}

export function moveMarks(m: DigestMovement): { marks: MoveMark[]; extent: number } {
  const marks = [...m.gainers, ...m.regressers].map((r) => ({
    key: r.fullName ?? r.name,
    name: r.name,
    fullName: r.fullName,
    d: r.dOverall,
    from: r.levelFrom,
    to: r.levelTo,
    crossedLevel: r.levelFrom !== r.levelTo,
  }));
  return { marks, extent: deltaExtent(marks.map((x) => x.d)) };
}
