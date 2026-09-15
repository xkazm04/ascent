// Regression detection + alert dispatch — the "live intelligence" layer. After an autoscan or a
// push-triggered re-scan, we diff the fresh report against the previously persisted one
// (engine.diffReports → ScanDiff) and decide whether it crossed a line worth interrupting a human
// for: a maturity demotion, a slide into "ungoverned", or a material score/dimension drop.
//
// The detector + message builder are PURE (unit-tested). dispatchAlert() is the only side-effect:
// it POSTs a Slack-compatible payload to the resolved sink — the org's own webhook
// (Organization.alertWebhookUrl, threaded in by the caller) when set, else the global
// ALERT_WEBHOOK_URL — and is otherwise a graceful no-op so the feature degrades cleanly with no
// configuration. Per-org routing keeps one tenant's fleet intelligence out of another's channel.
//
// EMAIL SINKS (G7-01). The same sink field also accepts `mailto:someone@example.com`, in which case
// dispatchAlert renders the message as mail and sends it through the ONE existing transport
// (src/lib/email) instead of POSTing. That is the whole email channel: no per-feature toggle, no second
// recipient list, and no send to anyone who wasn't deliberately configured as this org's sink by an
// admin. It is off in three independent ways by default — no sink stored, no global ALERT_WEBHOOK_URL,
// and no email provider (SES_FROM_EMAIL) — and each alert mail carries the unsubscribe link that clears
// the sink (see src/lib/email/alert-sink.ts + /api/email/unsubscribe).

import type { ScanDiff } from "@/lib/report/compare";
import { isWithinNoise, postureTransition } from "@/lib/maturity/noise";
// The mock sentinel comes from the attribution module rather than being restated here: a `mock` end is
// a different ruler on BOTH surfaces, and two copies of that name would eventually disagree.
import { MOCK_ENGINE } from "@/lib/maturity/attribution";
import { isPrivateOrInternalHost } from "@/lib/net/ssrf";

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

// --- Per-repo regression-alert cooldown (fleet-alerts-digests #4) ----------------------------------
// A repo whose overall score oscillates ACROSS the regression threshold (a flapping test, a noisy LLM
// re-grade, a dependency that lands then reverts) fires a fresh Slack alert on EVERY autoscan/push
// re-scan — the pager fatigue that trains a team to mute the exact channel the alert layer exists to
// keep credible. Suppress a repeat regression alert for the SAME repo inside a cooldown window.
// Best-effort + in-memory: a cooldown is spam-suppression, not a correctness guarantee, so a cold
// serverless start (empty map) at worst re-sends once — never drops a distinct new regression. Keyed by
// repo fullName; the map is globalThis-pinned so it survives Next.js HMR and a warm serverless instance.
//
// ONE CLAIM POOL, AND A PROMOTION CONSUMES IT (fleet-alerts promotions). The promotion push shares this
// map rather than getting its own: a repo oscillating across a band edge (L3→L4→L3 as an LLM re-grade
// or a reverted dependency moves it a point) is EXACTLY the flapping the cooldown exists to mute, and a
// separate pool would let it alternate "🎉 leveled up" / "🔻 regressed" every scan — each pool
// individually within its window, the channel unreadable. Consuming (stamping) rather than merely
// reading also means the two directions can't double-fire inside one window. The cost is real and
// accepted: a genuine demotion within 6h of a genuine promotion for the same repo is suppressed to a
// Slack push — but it is still detected, audited and remembered (the audit row + memory feed are
// written before the claim), so nothing is lost from the record, only from the pager.
const DEFAULT_REGRESSION_COOLDOWN_MINUTES = 360; // 6h between repeat alerts for one repo

/** Cooldown window (ms) between regression alerts for the SAME repo. REGRESSION_COOLDOWN_MINUTES
 *  (non-negative integer minutes), default 360 (6h); an explicit 0 disables the cooldown (every
 *  regression alerts). Blank/missing → default, never 0 (same blank-vs-zero rule as the cost rates). */
export function regressionCooldownMs(): number {
  const raw = process.env.REGRESSION_COOLDOWN_MINUTES;
  if (raw == null || raw.trim() === "") return DEFAULT_REGRESSION_COOLDOWN_MINUTES * 60_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) * 60_000 : DEFAULT_REGRESSION_COOLDOWN_MINUTES * 60_000;
}

// globalThis-pinned so the cooldown survives HMR (dev) and a warm serverless instance (prod) — a plain
// module const would reset on every reload and defeat the throttle.
const cooldownGlobal = globalThis as typeof globalThis & { __ascentRegressionCooldownAt?: Map<string, number> };
const regressionCooldownAt: Map<string, number> = (cooldownGlobal.__ascentRegressionCooldownAt ??= new Map());

/**
 * Check-and-STAMP the per-repo regression cooldown as ONE indivisible step (JS's single-threaded event
 * loop makes the read+write atomic): returns true when an alert may be sent now — and records `now` as
 * the last-sent time so the NEXT call within the window is suppressed — or false when the repo is still
 * inside its cooldown window. Stamping at the claim (not after a successful POST) also collapses the rare
 * overlapping-rescan case to a single alert. A cooldown of 0 always allows (feature disabled). Pure given
 * its args; `now` is injectable for tests.
 */
export function claimRegressionAlert(
  repoFullName: string,
  cooldownMs: number = regressionCooldownMs(),
  now: number = Date.now(),
): boolean {
  if (cooldownMs <= 0) return true; // disabled → never throttle
  const last = regressionCooldownAt.get(repoFullName);
  if (last != null && now - last < cooldownMs) return false; // still cooling down
  regressionCooldownAt.set(repoFullName, now);
  return true;
}

/** Test-only: clear the in-memory cooldown map so a suite's cases don't leak stamps into each other. */
export function __resetRegressionCooldowns(): void {
  regressionCooldownAt.clear();
}

export interface RepoAlertRef {
  fullName: string;
  /** Absolute or relative link to the report/what-changed view. */
  url?: string;
}

export interface AlertMessage {
  /** Plain-text fallback (Slack `text`). */
  text: string;
  /** Slack Block Kit blocks for a richer card; safe to ignore by non-Slack sinks. */
  blocks: unknown[];
}

const SEV_EMOJI: Record<AlertSeverity, string> = { critical: "🔻", warning: "⚠️", celebration: "🎉" };

/** A Slack Block-Kit `section` block with an `mrkdwn` text body — the shape the four message builders
 *  restated inline ~7 times. Pure; returns a fresh object each call. */
function mrkdwnSection(text: string): { type: "section"; text: { type: "mrkdwn"; text: string } } {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/** A Slack Block-Kit `context` block carrying a single `<url|label>` mrkdwn link — the footer the
 *  builders restated 3 times. Pure. */
function linkContext(url: string, label: string): { type: "context"; elements: { type: "mrkdwn"; text: string }[] } {
  return { type: "context", elements: [{ type: "mrkdwn", text: `<${url}|${label}>` }] };
}

/** Format a signed integer with an explicit leading sign for non-negatives (`+5`, `-3`, `0` → `+0`).
 *  Single-sources the `${n > 0 ? "+" : ""}${n}` idiom buildFleetDigestMessage restated three times.
 *  The boundary is `>= 0` to match the `gain` site; the two delta sites are only reached for a NONZERO
 *  move (a 0 overall delta renders as "no change" before this is called), so they never observe 0 —
 *  unifying on `>= 0` reproduces every previously-emitted string byte-for-byte. */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** English ordinal suffix for a non-negative integer (1st, 2nd, 3rd, 4th … 11th/12th/13th, 21st, 22nd).
 *  The digest percentile line hard-coded "th", so corpus percentiles ending in 1/2/3 (except the
 *  11–13 teens) rendered broken ordinals ("21th pctile") in the one artifact leaders read without
 *  opening the app — a sent Slack message can't be hot-fixed. (ambiguity-ui 2026-07-16 #5) */
export function ordinal(n: number): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[Math.abs(n) % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Build a Slack-compatible alert message from a regression verdict. Pure — no env, no Date.
 * The top movement attributions from the diff are included so the alert explains *why* the
 * score moved, not just that it did.
 */
export function buildRegressionMessage(repo: RepoAlertRef, diff: ScanDiff, verdict: RegressionVerdict): AlertMessage {
  const emoji = SEV_EMOJI[verdict.severity ?? "warning"];
  const headline = `${emoji} Ascent: ${repo.fullName} regressed`;
  const reasonLines = verdict.reasons.map((r) => `• ${r.message}`);
  const why = diff.movements.slice(0, 3);

  const textParts = [headline, ...reasonLines];
  if (why.length) textParts.push("", "Why:", ...why.map((m) => `• ${m}`));
  if (repo.url) textParts.push("", repo.url);
  const text = textParts.join("\n");

  const blocks: unknown[] = [
    mrkdwnSection(`*${headline}*`),
    mrkdwnSection(reasonLines.join("\n")),
  ];
  if (why.length) {
    blocks.push(mrkdwnSection(`*Why:*\n${why.map((m) => `• ${m}`).join("\n")}`));
  }
  if (repo.url) {
    blocks.push(linkContext(repo.url, "View report"));
  }
  return { text, blocks };
}

/**
 * Build the Slack message for a maturity PROMOTION. Pure — same family as buildRegressionMessage
 * (plain-text fallback + Block Kit sections + a report link), deliberately different in VOICE:
 *
 *   - 🎉, and the headline says "leveled up", not "regressed" — no alarm chrome anywhere.
 *   - the movement attributions are framed as "What got you here" (credit) rather than "Why:"
 *     (post-mortem), because this message's job is to be forwarded, not triaged.
 *   - no severity bullet list: a promotion has exactly one reason, and stacking it like a set of
 *     findings would make good news read like an incident report.
 */
export function buildPromotionMessage(repo: RepoAlertRef, diff: ScanDiff, verdict: PromotionVerdict): AlertMessage {
  const headline = `${SEV_EMOJI.celebration} Ascent: ${repo.fullName} leveled up`;
  const line =
    verdict.reasons[0]?.message ??
    `Maturity climbed ${diff.level.before.id} → ${diff.level.after.id} (${diff.level.after.name})`;
  const detail = `${line} · overall ${diff.overall.before} → ${diff.overall.after} (${signed(diff.overall.delta)})`;
  const why = diff.movements.slice(0, 3);

  const textParts = [headline, detail];
  if (why.length) textParts.push("", "What got you here:", ...why.map((m) => `• ${m}`));
  if (repo.url) textParts.push("", repo.url);

  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${detail}`)];
  if (why.length) blocks.push(mrkdwnSection(`*What got you here:*\n${why.map((m) => `• ${m}`).join("\n")}`));
  if (repo.url) blocks.push(linkContext(repo.url, "View report"));
  return { text: textParts.join("\n"), blocks };
}

/** Inputs for a weekly fleet digest — the periodic positive push, not just per-repo regressions. */
export interface FleetDigestInput {
  org: string;
  url?: string;
  repoCount: number;
  scannedCount: number;
  avgOverall: number;
  level: string; // e.g. "L3 · Defined"
  overallDelta: number | null; // vs the week's start (null = no baseline)
  gainers: { name: string; delta: number }[];
  regressers: { name: string; delta: number }[];
  topRecommendation: { title: string; repoCount: number } | null;
  /** Corpus percentile (0..100) for the exec digest, or null/undefined when no corpus yet. */
  percentile?: number | null;
  /** One-line forecast trajectory headline, or null/undefined when there's too little history. */
  trajectory?: string | null;
  /** Prepaid credits remaining, when the org is metered and running low — null/undefined omits the line. */
  creditsRemaining?: number | null;
  /**
   * MOONSHOT #1 — controls observed FAILING in the period, from the control ledger.
   *
   * Undefined omits the block entirely (a deployment without the ledger says nothing rather than
   * "0 controls failed", which would be a claim it cannot support). An empty array is the positive
   * statement "we looked and none failed" and renders as such.
   */
  controlsFailed?: { repo: string; control: string; detail: string }[];
  /**
   * THE N THE CONTROLS BLOCK IS STATED WITH (UAT `DANA-L1-015`).
   *
   * `control-observations.ts` states the coverage law in as many words: *any surface that prints a
   * control's state over a period must print its coverage beside it*, because "none failed this week"
   * read off two observations is a sentence the evidence does not support. The digest is the surface
   * that law was written for — it is the artifact a leader reads INSTEAD of opening the app, so it is
   * the one place where an unqualified all-clear is never corrected by the page underneath it.
   *
   * Undefined omits the line entirely, on the same three-state terms as `controlsFailed`: a caller
   * that could not read the ledger says nothing rather than printing a coverage of zero.
   */
  controlCoverage?: {
    /** Distinct (repo, control) pairs observed in the window. */
    pairs: number;
    /** Total observations behind the block. */
    observations: number;
    /** Largest silent stretch BETWEEN observations across the fleet, or null when no pair had two. */
    maxGapDays: number | null;
    /** The read hit the ledger's per-read cap, so `observations` is a FLOOR. Stated, never implied. */
    truncated: boolean;
  };
  /**
   * Dimensions that have held materially below an earlier reading (`detectStandingRegressions`),
   * newest concern per repo. Rendered as OBSERVATIONS, never as attributions — the block header says
   * so in as many words, because the one thing this must not become is the digest guessing at cause.
   *
   * Same three-state contract as `controlsFailed`: undefined omits the block (a caller that did not
   * compute it says nothing rather than "0 concerns"), an empty array is the positive statement
   * "we looked and nothing is standing down".
   */
  standingConcerns?: { repo: string; observation: string; evidence?: string[] }[];
}

/**
 * Build a Slack-compatible weekly fleet digest. Pure (no env, no Date). Turns the dashboard's
 * pull-only aggregates into a push channel: where regressions alert per-repo on a slide, this is the
 * positive periodic rollup (maturity, top movers, the highest-leverage gap) a leader gets without
 * opening the app — the habit loop org-analytics products live on.
 */
export function buildFleetDigestMessage(d: FleetDigestInput): AlertMessage {
  const delta =
    d.overallDelta == null
      // G4-04: an empty string here silently drops the "this week" number with zero indication why —
      // indistinguishable from "the fleet held exactly flat" to a reader. A null delta means no baseline
      // could be computed for the window at all (a freshly-onboarded org, or one whose entire scan
      // history is younger than the window boundary), which is a DIFFERENT fact than "flat" and must
      // read as one.
      ? " (not enough history yet for a week-over-week comparison)"
      : isWithinNoise(d.overallDelta)
        ? d.overallDelta === 0
          ? " (no change this week)"
          : ` (${signed(d.overallDelta)}, within noise this week)`
        : ` (${signed(d.overallDelta)} this week)`;
  const headline = `📊 Ascent weekly digest: ${d.org}`;
  const pctile = d.percentile != null ? ` · ${ordinal(d.percentile)} pctile` : "";
  const summary = `Fleet maturity *${d.avgOverall}/100* · ${d.level}${delta} · ${d.scannedCount}/${d.repoCount} repos scanned${pctile}`;
  const gain = (m: { name: string; delta: number }) => `• ${m.name} ${signed(m.delta)}`;

  // MOONSHOT #1 — the Controls block sits ABOVE the movers, and deliberately: a control that came
  // off a repo outranks every score delta on the page, and a reader who has to scroll past six
  // gainers to find it will stop finding it.
  const controlLine = (c: { repo: string; control: string; detail: string }) => `• ${c.repo} — ${c.control}: ${c.detail}`;
  const controlsHeading = d.controlsFailed?.length
    ? `Controls that failed this week (${d.controlsFailed.length}):`
    : "Controls: none failed this week.";
  // The coverage law (control-observations.ts): a state asserted over a period travels with its N, or
  // it is not an assurance statement. It matters MOST under the all-clear — "none failed" off three
  // observations is the sentence this line exists to qualify.
  const cov = d.controlCoverage;
  const coverageLine = cov
    ? cov.observations === 0
      ? "Coverage: no control was observed in this window — the all-clear above is not evidence."
      : `Coverage: ${cov.observations}${cov.truncated ? "+" : ""} observation${cov.observations === 1 ? "" : "s"} across ${cov.pairs} repo/control pair${cov.pairs === 1 ? "" : "s"}` +
        (cov.maxGapDays == null ? " (a single observation per pair — no gap measurable)." : `, largest gap ${cov.maxGapDays}d.`)
    : null;

  // Standing concerns sit beside the Controls block and for the same reason: a dimension that has been
  // down for a month outranks this week's ±3, and a reader who has to scroll past six gainers to find
  // it will stop finding it. The heading carries the disclaimer so the observation cannot be read as
  // an attribution even when a line is quoted out of the message.
  const standingLine = (c: { repo: string; observation: string; evidence?: string[] }) =>
    [`• ${c.repo} — ${c.observation}`, ...(c.evidence ?? []).map((e) => `    ${e}`)].join("\n");
  const standingHeading = d.standingConcerns?.length
    ? `Standing concerns (${d.standingConcerns.length}) — observed, cause not attributed:`
    : "Standing concerns: none open.";

  const lines: string[] = [headline, summary.replace(/\*/g, "")];
  if (d.trajectory) lines.push(d.trajectory);
  if (d.controlsFailed) lines.push("", controlsHeading, ...d.controlsFailed.map(controlLine), ...(coverageLine ? [coverageLine] : []));
  if (d.standingConcerns) lines.push("", standingHeading, ...d.standingConcerns.map(standingLine));
  if (d.gainers.length) lines.push("", "Top gainers:", ...d.gainers.map(gain));
  if (d.regressers.length) lines.push("", "Regressions:", ...d.regressers.map(gain));
  if (d.topRecommendation)
    lines.push("", `Highest-leverage gap: ${d.topRecommendation.title} (affects ${d.topRecommendation.repoCount} repo${d.topRecommendation.repoCount === 1 ? "" : "s"})`);
  if (d.creditsRemaining != null)
    lines.push("", `Credits remaining: ${d.creditsRemaining}, top up to keep autoscans flowing`);
  if (d.url) lines.push("", d.url);

  const blocks: unknown[] = [
    mrkdwnSection(`*${headline}*\n${summary}${d.trajectory ? `\n_${d.trajectory}_` : ""}`),
  ];
  if (d.controlsFailed)
    blocks.push(
      mrkdwnSection(
        (d.controlsFailed.length
          ? `*${controlsHeading}*\n${d.controlsFailed.map(controlLine).join("\n")}`
          : `_${controlsHeading}_`) + (coverageLine ? `\n_${coverageLine}_` : ""),
      ),
    );
  if (d.standingConcerns)
    blocks.push(
      mrkdwnSection(
        d.standingConcerns.length
          ? `*${standingHeading}*\n${d.standingConcerns.map(standingLine).join("\n")}`
          : `_${standingHeading}_`,
      ),
    );
  const mv: string[] = [];
  if (d.gainers.length) mv.push(`*Top gainers:*\n${d.gainers.map(gain).join("\n")}`);
  if (d.regressers.length) mv.push(`*Regressions:*\n${d.regressers.map(gain).join("\n")}`);
  if (mv.length) blocks.push(mrkdwnSection(mv.join("\n\n")));
  if (d.topRecommendation)
    blocks.push(
      mrkdwnSection(
        `*Highest-leverage gap:* ${d.topRecommendation.title} _(affects ${d.topRecommendation.repoCount} repo${d.topRecommendation.repoCount === 1 ? "" : "s"})_`,
      ),
    );
  if (d.creditsRemaining != null)
    blocks.push(mrkdwnSection(`*Credits remaining:* ${d.creditsRemaining}, top up to keep autoscans flowing`));
  if (d.url) blocks.push(linkContext(d.url, "Open the dashboard"));
  return { text: lines.join("\n"), blocks };
}

/** Inputs for a prepaid-credit lifecycle alert (low-water crossing or depletion). */
export interface LowCreditsInput {
  org: string;
  /** Balance after the debit that triggered the alert. */
  balance: number;
  /** The configured low-water mark the balance just landed on. */
  threshold: number;
  /** Link to the org dashboard (where the credits control lives), when a public base is known. */
  url?: string;
}

const DEFAULT_CREDITS_ALERT_THRESHOLD = 5;

/** Low-water mark for credit alerts: CREDITS_ALERT_THRESHOLD (non-negative integer), default 5.
 *  A blank/missing var means "default", never 0 — same blank-vs-zero rule as the cost rates. */
export function creditsAlertThreshold(): number {
  const raw = process.env.CREDITS_ALERT_THRESHOLD;
  if (raw == null || raw.trim() === "") return DEFAULT_CREDITS_ALERT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_CREDITS_ALERT_THRESHOLD;
}

/**
 * Whether a debit that moved the balance from `balanceBefore` to `balanceAfter` CROSSED an alert
 * line (the low-water threshold, or depletion at 0). Pure, range-based: a crossing happens when the
 * balance was strictly above the line before and at/below it after — so each line fires at most once
 * per descent, with no dedupe state, and the predicate no longer depends on the unenforced
 * cross-module invariant that debits are unit-sized (the old `balanceAfter === threshold` equality
 * silently never fired if any future bulk debit stepped OVER the line). A non-debit observation
 * (grant/refund/no-op) never alerts. (ambiguity-ui 2026-07-16 #3)
 */
export function isLowCreditsCrossing(balanceBefore: number, balanceAfter: number, threshold: number): boolean {
  if (balanceAfter >= balanceBefore) return false; // not a debit — a grant/refund/top-up never alerts
  return (balanceBefore > threshold && balanceAfter <= threshold) || (balanceBefore > 0 && balanceAfter <= 0);
}

/**
 * Build a Slack-compatible low-credits / depleted-balance alert. Pure (no env, no Date). Running
 * out of credits is a prepaid model's silent churn moment — autoscans stop and the trends the org
 * paid for flatline — so the crossing gets a proactive push through the same sink as regressions
 * and the weekly digest.
 */
export function buildLowCreditsMessage(d: LowCreditsInput): AlertMessage {
  const depleted = d.balance <= 0;
  const headline = depleted
    ? `🪫 Ascent: ${d.org} is out of scan credits`
    : `🪫 Ascent: ${d.org} is low on scan credits (${d.balance} left)`;
  const body = depleted
    ? "Private scans (manual and scheduled) are paused until the balance is topped up; maturity trends stop updating."
    : `The prepaid balance just hit the low-water mark (${d.threshold}). Top up before it runs out to keep scheduled scans flowing.`;

  const textParts = [headline, body];
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${body}`)];
  if (d.url) blocks.push(linkContext(d.url, "Manage credits"));
  return { text: textParts.join("\n"), blocks };
}

// --- G7-03: the three trigger classes the alert layer could always compute and never pushed ---------
// Goal-at-risk, a security flip, and a spend anomaly were each "open the dashboard and notice a number"
// gaps on the product's one push channel. All three are PURE builders in the buildRegressionMessage
// family (plain-text fallback + Block Kit sections + a link), so they inherit the email rendering, the
// per-org sink routing and the dispatch deadline for free. Detection helpers live beside them so the
// "is this worth a push" decision is unit-tested rather than restated at each call site.

/** One goal's standing, in the shape the pace fields of GoalProgress already provide. */
export interface GoalRisk {
  label: string;
  metricLabel: string;
  current: number;
  target: number;
  targetDate: string | null;
  /** Weekly gain still needed to hit the target by the deadline, when computable. */
  requiredPerWeek: number | null;
  /** Current weekly rate of change. */
  perWeek: number;
}

export interface GoalAtRiskInput {
  org: string;
  url?: string;
  goals: GoalRisk[];
}

/**
 * Build the goal-at-risk push. Fires on goals the plan layer already marks `pace: "behind"` — the one
 * fact a leader currently has to remember to go looking for. Pure.
 */
export function buildGoalAtRiskMessage(d: GoalAtRiskInput): AlertMessage {
  const n = d.goals.length;
  const headline = `${SEV_EMOJI.warning} Ascent: ${n} goal${n === 1 ? "" : "s"} off pace in ${d.org}`;
  const line = (g: GoalRisk) => {
    const by = g.targetDate ? ` by ${g.targetDate}` : "";
    const need =
      g.requiredPerWeek != null
        ? `: needs ${signed(Math.round(g.requiredPerWeek * 10) / 10)}/wk, running at ${signed(Math.round(g.perWeek * 10) / 10)}/wk`
        : `: running at ${signed(Math.round(g.perWeek * 10) / 10)}/wk`;
    return `• ${g.label}: ${g.metricLabel} ${g.current}/${g.target}${by}${need}`;
  };
  const lines = d.goals.map(line);
  const textParts = [headline, ...lines];
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*`), mrkdwnSection(lines.join("\n"))];
  if (d.url) blocks.push(linkContext(d.url, "Open the plan"));
  return { text: textParts.join("\n"), blocks };
}

/** A security event worth interrupting someone for: a fresh critical advisory or a gate pass→fail flip. */
export interface SecurityAlertItem {
  repo: string;
  /** One-line description ("2 new critical advisories", "Branch protection gate flipped to FAIL"). */
  detail: string;
  kind: "advisory" | "gate";
}

export interface SecurityAlertInput {
  org: string;
  url?: string;
  items: SecurityAlertItem[];
}

/**
 * Build the security push. `critical` severity: a new critical advisory or a governance gate flipping
 * pass→fail is the class of change a team wants to hear about the same day, not next Monday. Pure.
 */
export function buildSecurityAlertMessage(d: SecurityAlertInput): AlertMessage {
  const n = d.items.length;
  const headline = `${SEV_EMOJI.critical} Ascent: security standing dropped in ${d.org}`;
  const summary = `${n} repo${n === 1 ? "" : "s"} crossed a security line since the last check.`;
  const lines = d.items.map((i) => `• ${i.repo}: ${i.detail}`);
  const textParts = [headline, summary, ...lines];
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${summary}`), mrkdwnSection(lines.join("\n"))];
  if (d.url) blocks.push(linkContext(d.url, "Open governance"));
  return { text: textParts.join("\n"), blocks };
}

// ── MOONSHOT #1 — the CONTROL push ───────────────────────────────────────────────────────────────
//
// Distinct from the security push above, which is a D9 SCORE movement. This one says a NAMED control
// changed state, with the value either side and — when a webhook observed it — who did it.
//
// The `source` field is load-bearing for the reader, not decoration. A `probe` transition was
// re-read from GitHub seconds after an event; a `scan` one was noticed at the scan's cadence and may
// be hours old; a `conformance` one came from the repo's own doctor run (W1-A #16). An examiner asks
// which, and a message that flattens the three would be asserting a freshness it cannot support.

export type ControlAlertCode = "control-failed" | "control-restored" | "control-unmeasurable";

export interface ControlAlertItem {
  repo: string;
  /** Catalogue id, or a doctor check id when `source: "conformance"`. */
  controlId: string;
  /** Human label; falls back to `controlId` at the call site. */
  label?: string;
  code: ControlAlertCode;
  from: string;
  to: string;
  /** Values either side. Rendered only when they add something the states do not (2 → 0 approvals). */
  fromValue?: string | null;
  toValue?: string | null;
  source: "scan" | "probe" | "webhook" | "conformance";
  /** GitHub login, webhook-observed only. NEVER fabricated for scan/probe/conformance. */
  actorLogin?: string | null;
}

export interface ControlAlertInput {
  org: string;
  url?: string;
  items: ControlAlertItem[];
}

const CONTROL_VERB: Record<ControlAlertCode, string> = {
  "control-failed": "failed",
  "control-restored": "was restored",
  "control-unmeasurable": "became unreadable",
};

/**
 * Build the control push. Pure — no env, no clock.
 *
 * Severity is the MAX over the items, and the three codes do not mix loudness by accident: a batch
 * containing one `control-failed` is critical even if the other nine are restorations. A batch of
 * ONLY `control-unmeasurable` items is `info`, and `scan-alerts.ts` does not dispatch it to a sink —
 * losing a read is a fact for the record, not a page.
 */
export function buildControlAlertMessage(d: ControlAlertInput): AlertMessage {
  const failed = d.items.filter((i) => i.code === "control-failed").length;
  const severity: AlertSeverity = failed > 0 ? "critical" : d.items.some((i) => i.code === "control-restored") ? "celebration" : "warning";
  const emoji = failed > 0 ? SEV_EMOJI.critical : severity === "celebration" ? SEV_EMOJI.celebration : "👁️";
  const headline =
    failed > 0
      ? `${emoji} Ascent: a control stopped operating in ${d.org}`
      : severity === "celebration"
        ? `${emoji} Ascent: a control was restored in ${d.org}`
        : `${emoji} Ascent: a control became unreadable in ${d.org}`;
  const n = d.items.length;
  const summary = `${n} control change${n === 1 ? "" : "s"} observed${failed > 0 ? `, ${failed} failing` : ""}.`;

  const line = (i: ControlAlertItem) => {
    const name = i.label ?? i.controlId;
    // The values are printed only when they carry information the states do not — "2 → 0" explains a
    // required-approvals failure that "pass → fail" alone leaves abstract.
    const values = i.fromValue != null && i.toValue != null && i.fromValue !== i.toValue ? ` (${i.fromValue} → ${i.toValue})` : "";
    // The actor is named ONLY when one was observed. "by unknown" would be noise; silence here means
    // no webhook carried an actor, which is the honest reading of a probe- or scan-sourced row.
    const who = i.actorLogin ? ` by ${i.actorLogin}` : "";
    return `• ${i.repo} — ${name} ${CONTROL_VERB[i.code]}${values}${who} · observed via ${i.source}`;
  };

  const lines = d.items.map(line);
  const textParts = [headline, summary, ...lines];
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${summary}`), mrkdwnSection(lines.join("\n"))];
  if (d.url) blocks.push(linkContext(d.url, "Open governance"));
  return { text: textParts.join("\n"), blocks };
}

/** The severity a batch of control items should be recorded at. Exported so the dispatcher and the
 *  AlertEvent row agree without re-deriving the rule. */
export function controlAlertSeverity(items: readonly ControlAlertItem[]): "critical" | "celebration" | "info" {
  if (items.some((i) => i.code === "control-failed")) return "critical";
  if (items.some((i) => i.code === "control-restored")) return "celebration";
  return "info";
}

/** Cooldown key for a control push. Per (repo, control) so a branch-protection flip is never starved
 *  by a score push that already consumed the repo's generic regression slot, and so two different
 *  controls failing on the same repo both get through. */
export function controlCooldownKey(repoFullName: string, controlId: string): string {
  return `${repoFullName}#control:${controlId}`;
}

export interface SpendAnomalyInput {
  org: string;
  url?: string;
  /** Metered scans (or cost basis units) in the period that tripped the alert. */
  periodScans: number;
  /** Trailing per-period average the current period is measured against. */
  baseline: number;
  /** Ratio current/baseline, e.g. 2.4. */
  ratio: number;
  /**
   * Estimated USD for the period ACROSS EVERY INFERENCE LANE, when the usage layer could price it.
   *
   * MC-B32: this used to be fed `UsageSummary.estimatedCostUsd`, which prices the SCAN lane alone —
   * the same understatement MC-B12 fixed on the `/usage` headline tile, left behind in the one place
   * that pushes a number at an operator who is not looking at the page. The digest now sends
   * `allLanesCostUsd`, so the alert and the page it links to state the same figure.
   */
  estimatedCostUsd?: number | null;
  /** Calls in the period that no basis could price. Non-zero makes `estimatedCostUsd` a FLOOR, and
   *  the message says so — the same disclosure the lane rows and the headline tile carry. */
  unpricedCalls?: number;
}

/** Default multiple of the trailing average that counts as a spend anomaly. */
const DEFAULT_SPEND_ANOMALY_RATIO = 2;
/** Below this many scans in the period, a ratio is meaningless (1 → 3 is not an anomaly). */
const SPEND_ANOMALY_MIN_SCANS = 10;

/**
 * SPEND_ANOMALY_RATIO (a number > 1), default 2 — the multiple of the trailing average that trips the
 * alert. Blank/missing → the default, never 0 (the blank-vs-zero rule the cost rates use).
 */
export function spendAnomalyRatio(): number {
  const raw = process.env.SPEND_ANOMALY_RATIO;
  if (raw == null || raw.trim() === "") return DEFAULT_SPEND_ANOMALY_RATIO;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1 ? n : DEFAULT_SPEND_ANOMALY_RATIO;
}

/**
 * Is this period's metered volume an anomaly against its trailing baseline? Pure. Deliberately
 * one-sided (a DROP in spend is not a page) and floored at SPEND_ANOMALY_MIN_SCANS so a fleet doing
 * single-digit scans can't trip a "3× spend" alert on two extra runs. A zero baseline with real volume
 * counts — first spend on a previously idle org is exactly the surprise this exists to catch.
 */
export function isSpendAnomaly(periodScans: number, baseline: number, ratio: number = spendAnomalyRatio()): boolean {
  if (periodScans < SPEND_ANOMALY_MIN_SCANS) return false;
  if (baseline <= 0) return true;
  return periodScans / baseline >= ratio;
}

/** Build the spend-anomaly push. Pure. */
export function buildSpendAnomalyMessage(d: SpendAnomalyInput): AlertMessage {
  const headline = `${SEV_EMOJI.warning} Ascent: scan spend spiked in ${d.org}`;
  const mult = d.baseline > 0 ? `${(Math.round(d.ratio * 10) / 10).toFixed(1)}×` : "no prior";
  const body =
    d.baseline > 0
      ? `${d.periodScans} metered scans this period vs a ${Math.round(d.baseline)} trailing average (${mult}).`
      : `${d.periodScans} metered scans this period, against no prior activity.`;
  // "All lanes" is stated, not implied: a FinOps reader who reconciles this against an invoice must
  // know whether the figure covers scans alone. The unpriced count makes it readable as a floor.
  const floor =
    d.unpricedCalls && d.unpricedCalls > 0
      ? ` (a floor: ${d.unpricedCalls.toLocaleString()} call${d.unpricedCalls === 1 ? "" : "s"} could not be priced)`
      : "";
  const cost =
    d.estimatedCostUsd != null
      ? `Estimated inference cost this period, all lanes: $${d.estimatedCostUsd.toFixed(2)}${floor}.`
      : null;
  const textParts = [headline, body];
  if (cost) textParts.push(cost);
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${body}${cost ? `\n${cost}` : ""}`)];
  if (d.url) blocks.push(linkContext(d.url, "Open usage"));
  return { text: textParts.join("\n"), blocks };
}

/**
 * Build the "test alert" message an admin sends to confirm their sink is wired up. Pure — the same
 * shape as the other builders (plain-text fallback + a single Block-Kit section), so the test send
 * stops hand-assembling Block Kit inside the API route and joins the unit-tested builder family.
 */
export function buildTestAlertMessage(org: string): AlertMessage {
  const headline = `✅ Ascent test alert for ${org}`;
  const body = "If you can read this in your channel, alert routing works. Regression, low-credit and weekly-digest alerts will arrive here.";
  return {
    text: `${headline}\n${body}`,
    blocks: [mrkdwnSection(`*${headline}*\n${body}`)],
  };
}

/** Minimal email shape for a `mailto:` sink — one @, no whitespace, a dotted domain. Same rule as
 *  isValidEmail in @/lib/email (restated here to keep this module free of a server-only import). */
const SINK_EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The address a sink points at when it is an EMAIL sink (`mailto:you@example.com`), else null. Pure.
 * G7-01: the alert sink accepts an address alongside an https webhook so an org whose leadership
 * doesn't live in Slack can still receive regression alerts, the weekly digest and the credit/goal/
 * spend pushes. Kept here (not only in the email module) so `dispatchAlert` can branch without a
 * server-only import, and so the shape is pinned by this module's unit tests.
 */
export function emailSinkAddress(sink: string | null | undefined): string | null {
  const raw = sink?.trim();
  if (!raw || !/^mailto:/i.test(raw)) return null;
  const addr = (raw.slice("mailto:".length).split("?")[0] ?? "").trim();
  return SINK_EMAIL_SHAPE.test(addr) && addr.length <= 254 ? addr : null;
}

/**
 * Resolve the sink an alert should POST to: the org's own webhook when set (multi-tenant routing —
 * each tenant gets its own fleet intelligence), else the global ALERT_WEBHOOK_URL (single-tenant /
 * operator deployments), else null (no-op). Pure given its argument — the env read is the only
 * ambient input, matching the layer's existing convention.
 */
export function resolveAlertWebhook(orgWebhookUrl?: string | null): string | null {
  const org = orgWebhookUrl?.trim();
  if (org) return org;
  const global = process.env.ALERT_WEBHOOK_URL?.trim();
  return global || null;
}

/**
 * What KIND of sink an alert actually left by — for the AlertEvent history row, not for routing.
 *
 * Takes the ORG's sink field and RESOLVES it first (org → the global ALERT_WEBHOOK_URL → none), because
 * the row must describe the channel the message travelled on, not the column the caller happened to
 * read. Classifying the unresolved field gets two things wrong on a tenant riding the global fallback:
 * it reports `webhook` for a global `mailto:` sink (the mail went out; the record says otherwise), and
 * it reports `webhook` where the org had no sink at all instead of the honest `null`.
 *
 * `src/lib/scan-alerts.ts` and `src/lib/standard/conformance-alerts.ts` already classified a RESOLVED
 * url; this is the same rule, exported so a caller holding only the org's field cannot restate it
 * against the wrong input.
 */
export function sinkKindForOrg(orgWebhookUrl: string | null | undefined): "webhook" | "email" | null {
  const resolved = resolveAlertWebhook(orgWebhookUrl);
  if (!resolved) return null;
  return emailSinkAddress(resolved) ? "email" : "webhook";
}

/** Whether an alert sink is configured (so callers can skip the work entirely when it isn't).
 *  Pass the org's webhook (when known) so a tenant with its own sink counts even with no global. */
export function isAlertConfigured(orgWebhookUrl?: string | null): boolean {
  return resolveAlertWebhook(orgWebhookUrl) !== null;
}

/**
 * Validate a caller-supplied org webhook URL before storing it. Pure (unit-tested). The server
 * POSTs org data to this URL, so it must parse, be https, carry no inline credentials, and not
 * target a private/internal host — the established "validate outbound URLs built from caller input"
 * rule. The private/internal host check is the SHARED isPrivateOrInternalHost guard (same one the
 * branding logo-URL guard uses), so this now also rejects CGNAT 100.64/10, IPv6 unique-local
 * (fc00::/7) and link-local (fe80::), multicast/reserved, and internal hostnames (*.local/*.internal/
 * cloud metadata) the old hand-rolled list missed. DNS-rebinding is out of scope here.
 */
export function validateAlertWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length > 1000) return { ok: false, error: "Webhook URL is too long (max 1000 chars)." };
  // G7-01: an EMAIL sink (`mailto:you@example.com`) is a first-class sink value. Storing it is the
  // org's explicit opt-in to alert mail — an admin-authenticated act, on the same field and with the
  // same blast radius as pointing the sink at a Slack channel. Validated on shape only (no SSRF
  // surface: nothing is fetched), and normalized to a lowercase scheme so the dispatcher's check and
  // the stored value can't drift.
  if (/^mailto:/i.test(trimmed)) {
    const addr = emailSinkAddress(trimmed);
    if (!addr) return { ok: false, error: "mailto: sink must be a single valid email address." };
    return { ok: true, url: `mailto:${addr}` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Webhook must be an https:// URL." };
  if (parsed.username || parsed.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (isPrivateOrInternalHost(host)) return { ok: false, error: "Webhook host must be publicly reachable." };
  return { ok: true, url: parsed.toString() };
}

/** Per-POST deadline for an alert dispatch. A hung sink (a black-holed webhook, a Slack incident, a
 *  sink behind a firewall that never RSTs) must not block the caller indefinitely — this is critical
 *  for the weekly-digest loop, which dispatches to many orgs' sinks in one run and would otherwise let
 *  one slow tenant starve the rest until the socket dies. */
const DISPATCH_TIMEOUT_MS = 8000;

/**
 * POST an alert to its sink (Slack incoming-webhook compatible): `opts.webhookUrl` (the org's own
 * sink) when set, falling back to the global ALERT_WEBHOOK_URL. Returns true on a 2xx, false on any
 * failure or when no sink is configured — never throws, so a flaky webhook can't fail the scan that
 * produced the alert. The POST is bounded by DISPATCH_TIMEOUT_MS so a hung sink aborts (→ false)
 * rather than blocking; `signal` lets a caller abort with the surrounding work, composed with the
 * timeout so whichever fires first wins.
 */
export async function dispatchAlert(
  message: AlertMessage,
  opts: { signal?: AbortSignal; webhookUrl?: string | null; org?: string | null } = {},
): Promise<boolean> {
  const url = resolveAlertWebhook(opts.webhookUrl);
  if (!url) return false;
  // EMAIL SINK (G7-01). Branch before the POST, and reach the mail transport through a DYNAMIC import:
  // src/lib/email pulls in the provider factory (and, lazily, the AWS SDK), and this module is reachable
  // from a client bundle via @/lib/alerts' pure exports (DEFAULT_THRESHOLDS in /trends). A static import
  // would drag server-only code across that boundary — the failure mode that passes tsc and unit tests
  // and only breaks `next build`. Returns FALSE when nothing was actually sent (no provider configured),
  // which is what lets the digest release its once-per-window claim and retry.
  if (/^mailto:/i.test(url.trim())) {
    const to = emailSinkAddress(url);
    // A malformed mailto: sink must DEAD-END here. Falling through would hand `fetch` a mailto: URL
    // (a throw at best, an unpredictable request at worst) for a value the org clearly meant as mail.
    if (!to) {
      console.error("[alerts] sink is a malformed mailto: — nothing dispatched");
      return false;
    }
    try {
      const { dispatchAlertEmail } = await import("./email/alert-sink");
      return await dispatchAlertEmail(to, message, { org: opts.org ?? null });
    } catch (err) {
      console.error("[alerts] email dispatch error", err instanceof Error ? err.message : err);
      return false;
    }
  }
  const timeout = AbortSignal.timeout(DISPATCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message.text, blocks: message.blocks }),
      signal,
    });
    if (!res.ok) {
      console.error("[alerts] dispatch failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alerts] dispatch error", err instanceof Error ? err.message : err);
    return false;
  }
}
