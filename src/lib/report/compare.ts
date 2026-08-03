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

/**
 * What the score did about a gap the team marked done. Four states, and the distinction between the
 * first two is the whole point:
 *  - `not-measured` — the dimension wasn't scored in BOTH scans, so there is nothing to compare. This
 *    is NOT a failure to improve, and must never be reported as one.
 *  - `flat` — both scans measured it and the number is the same. An observation, not a verdict on the
 *    work: a score can lag a real change by a scan, and the team is allowed to be right.
 *  - `improved` / `declined` — both scans measured it and it moved.
 */
export type ReconciliationState = "not-measured" | "improved" | "flat" | "declined";

/** The reconciliation of one done recommendation against its own dimension's movement. */
export interface RecReconciliation {
  state: ReconciliationState;
  dimId: DimensionId;
  /** Only non-null when that scan measured the dimension — no invented numbers. */
  before: number | null;
  after: number | null;
  /** after − before; null in the `not-measured` state, by construction. */
  delta: number | null;
  /** One companion-voice line. An observation the team can disagree with, never an accusation. */
  note: string;
}

/**
 * "You marked this done — did the score move?" Pure, and honest about what it does not know: a
 * dimension missing from either side yields `not-measured` with a null delta rather than a 0 that
 * would read as "you closed it and nothing happened".
 *
 * The voice is deliberate. Ascent is a transition companion, not a grader: a flat or falling score
 * after a close is *information for the team*, not a challenge to their judgment, and nothing here
 * blocks, reverts or re-opens their `done`.
 */
export function reconcileDoneRec(
  dimId: DimensionId,
  before: number | null | undefined,
  after: number | null | undefined,
): RecReconciliation {
  const b = before ?? null;
  const a = after ?? null;
  if (b === null || a === null) {
    return {
      state: "not-measured",
      dimId,
      before: b,
      after: a,
      delta: null,
      note: `${dimId} wasn’t scored in both scans, so there’s nothing to compare yet.`,
    };
  }
  const delta = a - b;
  if (delta === 0) {
    return {
      state: "flat",
      dimId,
      before: b,
      after: a,
      delta,
      note: `${dimId} held at ${a} since the previous scan — the score hasn’t caught up yet.`,
    };
  }
  return {
    state: delta > 0 ? "improved" : "declined",
    dimId,
    before: b,
    after: a,
    delta,
    note:
      delta > 0
        ? `${dimId} rose ${signed(delta)} since the previous scan (${b} → ${a}).`
        : `${dimId} is ${Math.abs(delta)} lower than the previous scan (${b} → ${a}) — something else may have moved.`,
  };
}

/** A tracked recommendation that reached "done" between the two scans. */
export interface RecMovedToDone {
  id: string;
  title: string;
  dimId: DimensionId;
  /** Did the dimension this gap targeted actually move? See reconcileDoneRec. */
  reconciliation: RecReconciliation;
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

// ── Orphaned tracking ───────────────────────────────────────────────────────────────────────────
//
// The matcher above is deliberately conservative: two reworded gaps in one dimension are genuinely
// ambiguous, so it refuses to guess. Scan-persist then wrote `status: carried?.status ?? "open"` and
// the user's own tracking data — status, assignee, target date — vanished with NO error. The engine's
// honest refusal to guess was indistinguishable from data loss.
//
// This does NOT weaken the matcher. It names what the matcher couldn't carry, so the loss is visible
// and re-linkable instead of silent.

/** A previous scan's recommendation, with the planning state a re-scan must not lose. */
export interface TrackedRecIdentity extends RecIdentity {
  status: string;
  assigneeLogin: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  targetDate: string | null;
}

/** Carries user tracking worth preserving — anything past the untouched open/unassigned default. */
export function isTrackedRec(r: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">): boolean {
  return (r.status !== "" && r.status !== "open") || r.assigneeLogin != null || r.targetDate != null;
}

/** Same planning state — the signal that an orphan has already been re-applied to a new row. */
const sameTracking = (
  a: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">,
  b: Pick<TrackedRecIdentity, "status" | "assigneeLogin" | "targetDate">,
) => a.status === b.status && a.assigneeLogin === b.assigneeLogin && a.targetDate === b.targetDate;

/**
 * Previously-tracked recommendations the tiered matcher could not carry into the new scan.
 *
 * Self-healing without a schema column: an orphan is dropped once an UNMATCHED row in the new scan
 * carries its exact (status, assignee, targetDate) triple — which is precisely what re-linking does.
 * A brand-new unmatched row defaults to open/null/null and `isTrackedRec` excludes that, so an
 * untouched roadmap item can never silently absorb an orphan. Each such row retires at most one
 * orphan, so two identical orphans need two re-links.
 */
export function findOrphanedTracked(
  prev: readonly TrackedRecIdentity[],
  next: readonly TrackedRecIdentity[],
): TrackedRecIdentity[] {
  const matches = matchRecommendations(prev, next);
  const matchedPrev = new Set<number>();
  matches.forEach((m) => {
    if (m != null) matchedPrev.add(m);
  });
  // The candidate absorbers: rows the matcher left unpaired that ALREADY carry tracking of their own
  // (i.e. somebody applied it). Consumed one-for-one below.
  const absorbers = next.filter((n, j) => matches[j] == null && isTrackedRec(n));
  const used = new Set<number>();
  return prev.filter((p, i) => {
    if (matchedPrev.has(i) || !isTrackedRec(p)) return false;
    const hit = absorbers.findIndex((n, k) => !used.has(k) && n.dim === p.dim && sameTracking(n, p));
    if (hit >= 0) {
      used.add(hit);
      return false; // already re-linked onto a new row
    }
    return true;
  });
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
  // Dimensions scored on only ONE side (added to the model after the baseline, or dropped). Their
  // delta is correctly null (no invented numbers), but that null must not read as "nothing changed":
  // coercing it to 0 in the `unchanged` predicate made the headline say "No measurable change" above
  // a visible "— → 70" card after any dimension-model migration (trends-comparison 07-16 #3).
  let oneSidedDimCount = 0;

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

    // A one-sided dimension IS a change worth narrating — without a line here the appearance never
    // reached "Why it moved" (buildAttribution returns null when delta is null and no signals moved).
    const oneSided = !b !== !a;
    if (oneSided) oneSidedDimCount += 1;
    const oneSidedAttribution = a
      ? `${def.id}: added in the newer scan (scored ${a.score})`
      : `${def.id}: no longer scored in the newer scan (was ${b!.score})`;

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
      attribution: oneSided
        ? oneSidedAttribution
        : buildAttribution(def.id, delta, signalDelta, appearedSignals, disappearedSignals),
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
  // …and each one carries the reconciliation against its OWN dimension's movement. A backlog closed
  // for appearances used to be invisible to the platform that recommended it; now the close and the
  // score sit next to each other. `dimById` is the diff we just computed, so a dimension absent from
  // either scan yields `not-measured` rather than a fabricated zero delta.
  const dimById = new Map(dimensions.map((d) => [d.id, d]));
  const recsMovedToDone: RecMovedToDone[] = [];
  after.recommendations.forEach((r, i) => {
    if (r.status !== "done") return;
    const m = recMatches[i];
    if (m != null && before.recommendations[m]?.status === "done") return;
    const dimId = r.dimId as DimensionId;
    const d = dimById.get(dimId);
    recsMovedToDone.push({
      id: r.id,
      title: r.title,
      dimId,
      reconciliation: reconcileDoneRec(dimId, d?.before ?? null, d?.after ?? null),
    });
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
    // A dim present on only one side is a change even though its delta is null — see oneSidedDimCount.
    oneSidedDimCount === 0 &&
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
