// Pure diff engine for the "What changed" view — turns two scans of a repo into a
// structured story of cause and effect: per-dimension score deltas, level/posture
// transitions, gaps that newly closed vs newly opened, the concrete detector signals that
// appeared or disappeared (with a one-line attribution per moved dimension), and which
// tracked recommendations moved to done. No data access here — feed it two ComparableScans
// (see lib/db/scans.ts) or use diffReports() in the scoring engine to diff full reports.

import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionId, LevelId, Posture } from "@/lib/types";
import { DIMENSIONS, LEVEL_BY_ID, levelForScore, postureFor } from "@/lib/maturity/model";

export interface DimensionDiff {
  id: DimensionId;
  name: string;
  /** null when the dimension was absent from that scan (e.g. added after it). */
  before: number | null;
  after: number | null;
  /** after − before; null unless BOTH scans scored this dimension (no invented deltas). */
  delta: number | null;
  /** Deterministic signal-score delta (after − before); null unless both sides scored it.
   *  Lets the UI separate evidence-driven movement from an LLM judgment shift. */
  signalDelta: number | null;
  /** Gaps present in `before` but gone in `after` — progress made. */
  closedGaps: string[];
  /** Gaps present in `after` but not in `before` — new ground to cover. */
  openedGaps: string[];
  /** Detector evidence present in `after` but not `before` — concrete signals gained. */
  appearedSignals: string[];
  /** Detector evidence present in `before` but not `after` — concrete signals lost. */
  disappearedSignals: string[];
  /**
   * One-line, human-readable explanation of this dimension's movement, citing the concrete
   * signals behind it (e.g. "D2 +12: Found 18 test files; Coverage tracking configured").
   * null when nothing measurable moved. When the blended score moved but the deterministic
   * evidence didn't, it attributes the shift to the LLM judgment instead of inventing signals.
   */
  attribution: string | null;
}

/** A tracked recommendation that reached "done" between the two scans. */
export interface RecMovedToDone {
  id: string;
  title: string;
  dimId: DimensionId;
}

export interface LevelTransition {
  before: { id: LevelId; name: string };
  after: { id: LevelId; name: string };
  changed: boolean;
  /** True when the maturity level rose (band moved up), false when it fell. */
  up: boolean;
}

export interface AxisDelta {
  before: number;
  after: number;
  delta: number;
}

export interface ScanDiff {
  overall: AxisDelta;
  level: LevelTransition;
  adoption: AxisDelta;
  rigor: AxisDelta;
  posture: { before: Posture; after: Posture; changed: boolean };
  /** Ordered by the canonical model order (DIMENSIONS), dims absent from both omitted. */
  dimensions: DimensionDiff[];
  recsMovedToDone: RecMovedToDone[];
  closedGapCount: number;
  openedGapCount: number;
  appearedSignalCount: number;
  disappearedSignalCount: number;
  /**
   * Per-dimension attribution lines for the dimensions that moved, ordered by the magnitude
   * of the movement (largest first). This is the "explained movement" headline — every line
   * ties a score change to the specific evidence that drove it, not just a trend.
   */
  movements: string[];
  /** True when nothing measurable moved — lets the UI say so plainly instead of an empty panel. */
  unchanged: boolean;
}

/** Normalize an evidence/gap string for set comparison — phrasing varies in whitespace/case.
 *  Embedded counts/values are preserved, so "Found 6 test files" → "Found 18 test files"
 *  correctly reads as one signal disappearing and another appearing (the movement we want). */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A recommendation's cross-scan identity inputs: its dimension + free-form title. */
export interface RecIdentity {
  dim: string;
  title: string;
}

/** Normalize a recommendation title for cross-scan identity: case, punctuation, and whitespace are
 *  presentation noise a live LLM rephrases freely between scans ("…to go on" vs "…to go on here."). */
export function normalizeRecTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match next-scan recommendations to previous-scan rows by STABLE identity — the single matcher
 * behind both scan-persist carry-forward (status/assignee/due-date survive a re-scan) and this
 * module's recsMovedToDone. Raw titles are NOT stable across live-LLM scans (temperature, evidence
 * drift, provider failover all rephrase them), so matching runs in three tiers:
 *  1. exact dimension + title (mock / low-temp identical output);
 *  2. dimension + normalized title (pure rephrasing of case/punctuation/whitespace);
 *  3. unambiguous dimension: exactly ONE unmatched prior row and ONE unmatched next item share a
 *     dimension — a dimension's gap statement is the same gap restated, so pair them. Genuine
 *     ambiguity (two unmatched on either side) stays unmatched rather than guessing.
 * Each prior row matches at most one next item. Returns, for each `next` index, the matched
 * `prev` index (or null when nothing matched).
 */
export function matchRecommendations(
  prev: readonly RecIdentity[],
  next: readonly RecIdentity[],
): (number | null)[] {
  const result: (number | null)[] = next.map(() => null);
  const usedPrev = new Set<number>();

  // Tiers 1+2: claim by a dim-scoped key — exact first, then normalized.
  const claim = (key: (r: RecIdentity) => string) => {
    const byKey = new Map<string, number[]>();
    prev.forEach((p, i) => {
      if (usedPrev.has(i)) return;
      const k = key(p);
      const list = byKey.get(k);
      if (list) list.push(i);
      else byKey.set(k, [i]);
    });
    next.forEach((n, j) => {
      if (result[j] !== null) return;
      const pick = byKey.get(key(n))?.find((i) => !usedPrev.has(i));
      if (pick !== undefined) {
        result[j] = pick;
        usedPrev.add(pick);
      }
    });
  };
  claim((r) => `${r.dim}::${r.title}`);
  claim((r) => `${r.dim}::${normalizeRecTitle(r.title)}`);

  // Tier 3: pair the lone unmatched prior row and lone unmatched next item of the same dimension.
  const leftoverPrev = new Map<string, number[]>();
  prev.forEach((p, i) => {
    if (usedPrev.has(i)) return;
    const list = leftoverPrev.get(p.dim);
    if (list) list.push(i);
    else leftoverPrev.set(p.dim, [i]);
  });
  const leftoverNext = new Map<string, number[]>();
  next.forEach((n, j) => {
    if (result[j] !== null) return;
    const list = leftoverNext.get(n.dim);
    if (list) list.push(j);
    else leftoverNext.set(n.dim, [j]);
  });
  for (const [dim, [j, ...restNext]] of leftoverNext) {
    const [i, ...restPrev] = leftoverPrev.get(dim) ?? [];
    if (j !== undefined && i !== undefined && restNext.length === 0 && restPrev.length === 0) {
      result[j] = i;
      usedPrev.add(i);
    }
  }
  return result;
}

/** Signed integer for an attribution line ("+12" / "-7"). */
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Build the one-line movement attribution for a dimension, citing concrete evidence.
 * Returns null when nothing measurable moved (no score change and no signal change).
 */
function buildAttribution(
  id: DimensionId,
  delta: number | null,
  signalDelta: number | null,
  appeared: string[],
  disappeared: string[],
): string | null {
  const moved = delta !== null && delta !== 0;
  const signalsChanged = appeared.length > 0 || disappeared.length > 0;
  if (!moved && !signalsChanged) return null;

  const parts: string[] = [...appeared, ...disappeared.map((s) => `removed ${s}`)];

  // Score moved but the deterministic evidence didn't: attribute it to the LLM judgment
  // rather than implying new signals appeared.
  if (parts.length === 0 && moved) {
    parts.push(
      signalDelta && signalDelta !== 0
        ? `signal score ${signed(signalDelta)} with no change in named evidence`
        : "assessment shifted (no change in detected signals)",
    );
  }

  const head = delta !== null ? `${id} ${signed(delta)}` : id;
  return `${head}: ${parts.join("; ")}`;
}

/**
 * Diff two scans into a "What changed" summary. `after` is the target being evaluated
 * (typically the newer scan) and `before` is the baseline; every delta is `after − before`.
 * Passing an older scan as `after` is valid — the deltas simply read as regressions.
 */
export function diffScans(before: ComparableScan, after: ComparableScan): ScanDiff {
  const beforeDims = new Map(before.dimensions.map((d) => [d.dimId, d]));
  const afterDims = new Map(after.dimensions.map((d) => [d.dimId, d]));

  const dimensions: DimensionDiff[] = [];
  let closedGapCount = 0;
  let openedGapCount = 0;
  let appearedSignalCount = 0;
  let disappearedSignalCount = 0;

  for (const def of DIMENSIONS) {
    const b = beforeDims.get(def.id);
    const a = afterDims.get(def.id);
    if (!b && !a) continue;

    const beforeScore = b ? b.score : null;
    const afterScore = a ? a.score : null;
    const delta = beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null;
    const signalDelta =
      b && a ? a.signalScore - b.signalScore : null;

    let closedGaps: string[] = [];
    let openedGaps: string[] = [];
    let appearedSignals: string[] = [];
    let disappearedSignals: string[] = [];
    if (b && a) {
      // Compare only when both scans scored the dimension — otherwise movement is noise.
      const beforeGaps = new Set(b.gaps.map(norm));
      const afterGaps = new Set(a.gaps.map(norm));
      closedGaps = b.gaps.filter((g) => !afterGaps.has(norm(g)));
      openedGaps = a.gaps.filter((g) => !beforeGaps.has(norm(g)));

      const beforeEvidence = new Set(b.evidence.map(norm));
      const afterEvidence = new Set(a.evidence.map(norm));
      appearedSignals = a.evidence.filter((e) => !beforeEvidence.has(norm(e)));
      disappearedSignals = b.evidence.filter((e) => !afterEvidence.has(norm(e)));
    }
    closedGapCount += closedGaps.length;
    openedGapCount += openedGaps.length;
    appearedSignalCount += appearedSignals.length;
    disappearedSignalCount += disappearedSignals.length;

    dimensions.push({
      id: def.id,
      name: (a ?? b)!.name,
      before: beforeScore,
      after: afterScore,
      delta,
      signalDelta,
      closedGaps,
      openedGaps,
      appearedSignals,
      disappearedSignals,
      attribution: buildAttribution(def.id, delta, signalDelta, appearedSignals, disappearedSignals),
    });
  }

  // The "explained movement" headline: every dimension that moved, biggest swing first,
  // each tied to the concrete evidence behind it.
  const movements = dimensions
    .filter((d) => d.attribution !== null)
    .sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0))
    .map((d) => d.attribution as string);

  // Recommendations that moved to done: done in `after`, and NOT already done in `before` —
  // matched by the same tiered identity carry-forward uses, so a rephrased title still pairs
  // with its prior row. A brand-new done item — no `before` match — counts too.
  const recMatches = matchRecommendations(
    before.recommendations.map((r) => ({ dim: r.dimId, title: r.title })),
    after.recommendations.map((r) => ({ dim: r.dimId, title: r.title })),
  );
  const recsMovedToDone: RecMovedToDone[] = [];
  after.recommendations.forEach((r, i) => {
    if (r.status !== "done") return;
    const m = recMatches[i];
    if (m != null && before.recommendations[m]?.status === "done") return;
    recsMovedToDone.push({ id: r.id, title: r.title, dimId: r.dimId as DimensionId });
  });

  const beforeLevel = LEVEL_BY_ID[before.level as LevelId] ?? levelForScore(before.overallScore);
  const afterLevel = LEVEL_BY_ID[after.level as LevelId] ?? levelForScore(after.overallScore);
  const beforePosture = postureFor(before.adoptionScore, before.rigorScore);
  const afterPosture = postureFor(after.adoptionScore, after.rigorScore);

  const overall: AxisDelta = {
    before: before.overallScore,
    after: after.overallScore,
    delta: after.overallScore - before.overallScore,
  };

  const unchanged =
    overall.delta === 0 &&
    !((beforeLevel.id !== afterLevel.id) || (beforePosture.id !== afterPosture.id)) &&
    closedGapCount === 0 &&
    openedGapCount === 0 &&
    appearedSignalCount === 0 &&
    disappearedSignalCount === 0 &&
    recsMovedToDone.length === 0 &&
    dimensions.every((d) => (d.delta ?? 0) === 0);

  return {
    overall,
    level: {
      before: { id: beforeLevel.id, name: beforeLevel.name },
      after: { id: afterLevel.id, name: afterLevel.name },
      changed: beforeLevel.id !== afterLevel.id,
      up: afterLevel.band[0] > beforeLevel.band[0],
    },
    adoption: {
      before: before.adoptionScore,
      after: after.adoptionScore,
      delta: after.adoptionScore - before.adoptionScore,
    },
    rigor: {
      before: before.rigorScore,
      after: after.rigorScore,
      delta: after.rigorScore - before.rigorScore,
    },
    posture: { before: beforePosture, after: afterPosture, changed: beforePosture.id !== afterPosture.id },
    dimensions,
    recsMovedToDone,
    closedGapCount,
    openedGapCount,
    appearedSignalCount,
    disappearedSignalCount,
    movements,
    unchanged,
  };
}
