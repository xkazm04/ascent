// Pure alert verdicts and signal thresholds, independent of cooldown state and delivery.
import type { ScanDiff } from '@/lib/report/compare';
import { isWithinNoise, postureTransition } from '@/lib/maturity/noise';
import { MOCK_ENGINE } from '@/lib/maturity/attribution';


/**
 * How loud the alert is — drives whether/how prominently it's surfaced (SEV_EMOJI, the digest, the
 * audit payload). `celebration` is the one NON-alarm band: an upward level change. It exists as a
 * severity rather than a separate axis so every renderer that already switches on severity gets the
 * celebratory chrome for free instead of borrowing 🔻/⚠️ for good news.
 */
export type AlertSeverity = "critical" | "warning" | "celebration";

export interface RegressionReason {
  severity: AlertSeverity;
  /** Short, human-readable explanation (e.g. "Maturity dropped L4 → L3"). */
  message: string;
  /** Machine code for routing/testing. */
  code: "level-demotion" | "posture-ungoverned" | "overall-drop" | "dimension-drop";
}

export interface RegressionVerdict {
  regressed: boolean;
  severity: AlertSeverity | null;
  reasons: RegressionReason[];
}

export interface RegressionThresholds {
  /** Overall-score drop (points) that counts as a regression. */
  overallDrop: number;
  /** Single-dimension drop (points) that counts as a regression. */
  dimensionDrop: number;
}

// The overall-drop threshold (5) sits comfortably ABOVE the scan-to-scan noise band (±2 — two identical-
// commit re-scans moved 0/±1; see @/lib/maturity/noise), so a regression alert never fires on model
// jitter. The dimension threshold (15) is well clear of the ±25 LLM guardband on a single dimension.
export const DEFAULT_THRESHOLDS: RegressionThresholds = { overallDrop: 5, dimensionDrop: 15 };

/**
 * Movement-gate for the weekly fleet digest — whether this period is worth a push at all. A leader who
 * relies on the digest *instead of* opening the app filters it out fast if it cries "no change this
 * week" every Monday, so a flat period should stay silent. Sends only on real signal: a level change, a
 * regression, an overall move beyond the scan-to-scan noise band, a genuine gainer, or a depleting
 * credit balance (always worth the heads-up). Pure — the cron passes the period's already-computed
 * aggregates. This is an adaptive cadence (notify on news); a fixed per-org cadence would need a stored
 * preference + last-sent timestamp.
 */
export function digestHasSignal(s: {
  overallDelta: number | null;
  levelChanges: number;
  regressions: number;
  gainersBeyondNoise: number;
  creditLow: boolean;
  /** MOONSHOT #1 — controls observed flipping to `fail` in the period. Optional so every existing
   *  caller keeps compiling and keeps its exact behaviour; absent means "not counted", not zero. */
  controlsFailed?: number;
  /** Dimensions holding materially below an earlier reading (`detectStandingRegressions`). Optional
   *  on the same terms as `controlsFailed`: absent means "not computed", not zero. */
  standingConcerns?: number;
}): boolean {
  if (s.creditLow) return true;
  // A STANDING CONCERN IS ALWAYS SIGNAL, AND KEEPS BEING SIGNAL. Every other condition here is a
  // MOVEMENT, so a decline that has stopped moving stops being news — which is precisely how a repo
  // sat twenty-one points down for eighteen scans with nothing said. A shortfall that persists is
  // re-stated every period it persists, on the same reasoning as `creditLow` above: the reader needs
  // to know it is STILL true, not only that it once happened.
  if ((s.standingConcerns ?? 0) > 0) return true;
  // A FAILED CONTROL IS ALWAYS SIGNAL. A week in which branch protection came off a repo and the
  // scores happened not to move is precisely the week the digest exists for — filtering it out on a
  // flat score would be the digest silently withholding its most consequential fact.
  if ((s.controlsFailed ?? 0) > 0) return true;
  if (s.levelChanges > 0 || s.regressions > 0 || s.gainersBeyondNoise > 0) return true;
  return s.overallDelta != null && !isWithinNoise(s.overallDelta);
}

/**
 * Decide whether a scan-to-scan diff is a regression worth alerting on. `diff` reads as
 * `after − before`, so negative deltas are slides. Reasons are returned strongest-first; the
 * overall severity is the max of the individual reasons (a level demotion or a slide into
 * "ungoverned" is critical; score/dimension slides are warnings).
 */
export function detectRegression(
  diff: ScanDiff,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionVerdict {
  const reasons: RegressionReason[] = [];

  if (diff.level.changed && !diff.level.up) {
    reasons.push({
      severity: "critical",
      code: "level-demotion",
      message: `Maturity dropped ${diff.level.before.id} → ${diff.level.after.id} (${diff.level.after.name})`,
    });
  }

  // Sliding INTO "ungoverned" (heavy AI, light guardrails) is the posture we most want to catch.
  // Gated on postureTransition, not on `changed` alone: the quadrant cuts at exactly 50 per axis, so a
  // repo hovering at 49/51 flips its label on a re-scan of an unchanged commit and fires this CRITICAL
  // alert on pure wobble. The corridor test (enter ≥52 / leave <48) keeps the classification untouched
  // and only asks whether the crossing is far enough from the cut to be evidence rather than noise.
  const postureNews = postureTransition(diff.posture.before.id, diff.posture.after.id, {
    adoption: diff.adoption.after,
    rigor: diff.rigor.after,
  });
  if (postureNews !== "held" && diff.posture.after.id === "ungoverned" && diff.posture.before.id !== "ungoverned") {
    reasons.push({
      severity: "critical",
      code: "posture-ungoverned",
      message: `Posture slid to "${diff.posture.after.label}": AI velocity outran the guardrails`,
    });
  }

  if (diff.overall.delta <= -thresholds.overallDrop) {
    reasons.push({
      severity: "warning",
      code: "overall-drop",
      message: `Overall score fell ${diff.overall.delta} (${diff.overall.before} → ${diff.overall.after})`,
    });
  }

  const worstDim = diff.dimensions
    .filter((d) => typeof d.delta === "number" && (d.delta as number) <= -thresholds.dimensionDrop)
    .sort((a, b) => (a.delta as number) - (b.delta as number))[0];
  if (worstDim) {
    reasons.push({
      severity: "warning",
      code: "dimension-drop",
      message: `${worstDim.id} ${worstDim.name} fell ${worstDim.delta} (${worstDim.before} → ${worstDim.after})`,
    });
  }

  const regressed = reasons.length > 0;
  const severity: AlertSeverity | null = !regressed
    ? null
    : reasons.some((r) => r.severity === "critical")
      ? "critical"
      : "warning";
  return { regressed, severity, reasons };
}

// --- Promotion (the one push that isn't bad news) --------------------------------------------------

export interface PromotionReason {
  severity: "celebration";
  /** Short, human-readable explanation (e.g. "Maturity climbed L3 → L4 (Integrated)"). */
  message: string;
  code: "level-promotion";
}

export interface PromotionVerdict {
  promoted: boolean;
  severity: "celebration" | null;
  reasons: PromotionReason[];
}

/**
 * The counterpart condition to detectRegression, over the SAME ScanDiff and living beside it so the
 * detection layer stays one module: did this scan cross a maturity band UPWARD? Every other condition
 * in this file fires on a slide (`diff.level.up` only ever SUPPRESSED an alert), so the L3→L4 moment a
 * team would happily paste into Slack was the one durable event the layer stayed silent about.
 *
 * Why it is a sibling function rather than another `reasons` entry inside detectRegression: that
 * verdict's `regressed` flag is load-bearing downstream — it gates the `scan.regression` audit row and
 * the regression memory in src/lib/memory/scan-feed.ts. A celebration that flipped `regressed` (or that
 * rode along in `reasons` on a mixed scan) would file a promotion as a regression in the org's audit
 * trail and its memory store. Same module, same diff, same message-builder family; separate verdict.
 *
 * Pure — no env, no Date, no I/O.
 */
export function detectPromotion(diff: ScanDiff): PromotionVerdict {
  if (!diff.level.changed || !diff.level.up) return { promoted: false, severity: null, reasons: [] };
  return {
    promoted: true,
    severity: "celebration",
    reasons: [
      {
        severity: "celebration",
        code: "level-promotion",
        message: `Maturity climbed ${diff.level.before.id} → ${diff.level.after.id} (${diff.level.after.name})`,
      },
    ],
  };
}

// --- Standing regressions: the decline nobody was told about ---------------------------------------
//
// WHY THIS EXISTS. In a 21-run campaign, `kp`'s D9 (Supply Chain & Security) went 93 → 96 → 75 at run
// 3 and sat at 75 for eighteen further runs. Twenty-one points, permanent, and every surface stayed
// quiet. The likeliest cause is mechanical: that run added two large new workflows, and D9's checks
// are RATIOS ("N/M workflows set an explicit permissions: scope"), so adding surface diluted them.
//
// Two independent silences produced that outcome, and this detector answers both:
//
//   1. EVERY EXISTING SIGNAL IS AN EVENT, NOT A STATE. `detectRegression` compares ONE adjacent pair,
//      and `getOrgMovers` compares a period's ends. Both were right to say nothing on runs 4–21: the
//      adjacent delta was zero every time. But "nothing changed this week" and "this repo has been
//      twenty-one points down for a month" are different facts, and only the first was reachable.
//   2. ATTRIBUTION REFUSES WHAT IT CANNOT EXPLAIN. `src/lib/maturity/attribution.ts` declines to CLAIM
//      a delta across a mock floor, inside the noise band, on an uncommitted lane or across a
//      platform-fold mismatch. That is correct, and it is the guard that stops the loop inventing
//      lifts — but the same guard silences a true decline. A guard against false CLAIMS must not
//      become a guard against true REGRESSIONS, so nothing below consults it: this detector makes no
//      claim about cause, only about the readings.
//
// It is computed from PERSISTED SCANS ALONE. A regression caused by a human commit deserves the same
// alarm as one caused by a lane, so the loop is not an input.

/**
 * How far below an earlier reading a dimension must sit before the shortfall is worth standing up.
 * Deliberately several times `SCORE_NOISE_BAND` (2, the measured overall model wobble — see
 * attribution.ts, which also records that the band is CONSERVATIVE per-dimension because a single
 * dimension's guardband is wider). 10 keeps this clear of that widened per-dimension wobble while
 * staying well below the per-scan `dimensionDrop` alarm (15) — a standing concern is allowed to be
 * quieter than a page, because it is earned by persistence rather than by size.
 */
export const STANDING_REGRESSION_DROP = 10;

/**
 * How many CONSECUTIVE scans the shortfall must hold before it is a standing concern. One scan below
 * the line is the event `detectRegression` already owns, and a single-scan dip that recovers is
 * exactly the flap the cooldown exists to mute — so a concern is only raised once the repo has been
 * re-measured at the depressed level three times over.
 */
export const STANDING_REGRESSION_SCANS = 3;

/** How far back a standing-regression read walks per repo. Bounds the query; a shortfall older than
 *  this many scans is still reported, just measured against the oldest reading in reach. */
export const STANDING_REGRESSION_LOOKBACK = 20;

/** One persisted scan, reduced to what the standing detector reads. `HistoryPoint` satisfies it
 *  structurally, and so does a raw `{ scannedAt, engineProvider, dimensions }` row select. */
export interface StandingScanPoint {
  /** Scan id, when the caller has one — carried through so a surface can link the two readings. */
  id?: string;
  /** ISO timestamp. */
  scannedAt: string;
  /** Engine that produced this reading. A `mock` end is a DIFFERENT RULER (attribution.ts's first
   *  refusal) and is dropped from the series rather than compared against — including it would
   *  manufacture concerns out of an engine swap. Undefined = unknown, which is treated as real. */
  engineProvider?: string;
  dimensions: { dimId: string; score: number }[];
}

/**
 * A dimension that has held materially below an earlier reading. Every field is an OBSERVATION: two
 * readings, their dates, and how long the shortfall has persisted. Nothing here asserts a cause.
 */
export interface StandingConcern {
  dimId: string;
  /** The most recent reading. */
  current: number;
  currentAt: string;
  currentScanId?: string;
  /** The reading the shortfall is measured against — the most recent scan that sat `drop` or more
   *  ABOVE every scan since. */
  baseline: number;
  baselineAt: string;
  baselineScanId?: string;
  /** `baseline - current`, always ≥ `STANDING_REGRESSION_DROP` at the time it is raised. */
  drop: number;
  /** How many scans have been taken at the depressed level (≥ `STANDING_REGRESSION_SCANS`). */
  scansHeld: number;
  /** ISO timestamp of the FIRST scan at the depressed level — when the shortfall began. */
  since: string;
  /** Signals that appeared/disappeared between the two named scans, when the caller supplied the
   *  evidence to derive them (see `getOrgStandingConcerns`). Never a cause claim — a list. */
  evidence?: string[];
  /** The one-line, cause-free rendering. */
  observation: string;
}

/** `2026-08-14T09:02:00.000Z` → `2026-08-14`. Dates, not timestamps: a standing concern is measured
 *  in scans and days, and a wall-clock time implies a precision the observation does not have. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Every dimension of `points[0]` that has held ≥ `drop` below an earlier reading for ≥ `scans`
 * consecutive readings. `points` is NEWEST-FIRST (the order every history reader already returns).
 *
 * The walk, per dimension: keep a running maximum of the readings seen so far (newest outward) and
 * step back until one is `drop` or more ABOVE that maximum. Finding it means *every* scan since that
 * reading has sat at least `drop` below it — which is the precise sense of "fell and stayed down",
 * and is why a plateau eighteen scans long is still measured against the reading before the fall
 * rather than against a three-scan-ago reading that is itself part of the plateau. The FIRST such
 * reading wins (the nearest baseline, so the claim is the smallest one the evidence supports), and if
 * it is fewer than `scans` back the dimension is skipped: a fresh drop is an event, not yet a state.
 *
 * Pure — no env, no Date, no I/O. `mock`-engine points are dropped first, and a dimension missing
 * from a point is skipped for that point rather than read as zero.
 */
export function detectStandingRegressions(
  points: readonly StandingScanPoint[],
  opts: { drop?: number; scans?: number } = {},
): StandingConcern[] {
  const drop = opts.drop ?? STANDING_REGRESSION_DROP;
  const hold = opts.scans ?? STANDING_REGRESSION_SCANS;
  const real = points.filter((p) => p.engineProvider !== MOCK_ENGINE);
  if (real.length < hold + 1) return [];

  const dimIds = (real[0]?.dimensions ?? []).map((d) => d.dimId);
  const out: StandingConcern[] = [];

  for (const dimId of dimIds) {
    const series: { score: number; scannedAt: string; id?: string }[] = [];
    for (const p of real) {
      const hit = p.dimensions.find((d) => d.dimId === dimId);
      if (hit) series.push({ score: hit.score, scannedAt: p.scannedAt, ...(p.id ? { id: p.id } : {}) });
    }
    const current = series[0];
    if (!current || series.length < hold + 1) continue;

    let depressedMax = current.score;
    for (let i = 1; i < series.length; i++) {
      const candidate = series[i];
      const fell = series[i - 1];
      if (!candidate || !fell) break;
      if (candidate.score - depressedMax >= drop) {
        if (i >= hold) {
          const gap = candidate.score - current.score;
          out.push({
            dimId,
            current: current.score,
            currentAt: current.scannedAt,
            ...(current.id ? { currentScanId: current.id } : {}),
            baseline: candidate.score,
            baselineAt: candidate.scannedAt,
            ...(candidate.id ? { baselineScanId: candidate.id } : {}),
            drop: gap,
            scansHeld: i,
            since: fell.scannedAt,
            observation:
              `${dimId} has held ${gap} points below its ${dayOf(candidate.scannedAt)} ` +
              `reading (${candidate.score} → ${current.score}) across ${i} scan${i === 1 ? "" : "s"} since ${dayOf(fell.scannedAt)}`,
          });
        }
        break; // nearest qualifying baseline decides, in both directions
      }
      depressedMax = Math.max(depressedMax, candidate.score);
    }
  }

  return out.sort((a, b) => b.drop - a.drop || a.dimId.localeCompare(b.dimId));
}
