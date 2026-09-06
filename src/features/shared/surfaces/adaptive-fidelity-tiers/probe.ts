// The producer side of the subject as one pure reducer: the constants with their derivations, the
// window statistic, the asymmetric transition rule with its dead band, the settle budget with its
// unconditional deadline, the idle deferral with two named reapers, and the preference short-circuit
// that decides whether the probe exists at all. No React, no clock: the scene feeds it windows.

import { lowerTier, PREFERENCE_TIER, stepDown, stepUp, type Tier } from "./budgets";
import { TRACE, windowSamples, type WindowKind } from "./fixtures";

// ── Every constant carries its derivation (count-carries-predicate) ────────────────────────────────
/** Samples per window: one second at the lowest refresh we design for (60 Hz); long enough that a single 80 ms GC pause sits under the p90 instead of deciding a tier. Fixed in COUNT, not wall-clock, so a slow device's window is the same statistic as a fast one's. */
export const WINDOW_SAMPLES = 60;
/** The tail, not the mean: the 6 worst of 60 frames are what the user felt. */
export const PERCENTILE = 0.9;
/** Absolute, not a fraction of the panel's budget: two 60 Hz frames (2 × 16.7 ms). A p90 here means one frame in ten dropped a whole frame — perceptible stutter on any panel. */
export const DOWNGRADE_MS = 33;
/** One frame plus scheduling noise. The 13 ms band up to DOWNGRADE_MS is wider than the fixture's cost step between adjacent tiers (TIER_COST_MS: 6 ms), so changing the tier cannot move a window across both thresholds — the loop cannot close. */
export const UPGRADE_MS = 20;
/** Three consecutive good windows = three seconds of clean tail. Fewer promotes an idle stretch; more strands a capable device after one slow patch. */
export const UPGRADE_RUN = 3;
/** Three times the downgrade threshold: the window is not marginal, so walk straight to the floor rather than one visible stutter per rung. */
export const CATASTROPHIC_MS = 100;
/** Wall-clock from the FIRST SAMPLE: spans first load plus the first real interaction on the slow devices this exists for. Unconditional — an unsettled device resolves DOWN at the deadline. */
export const SETTLE_MS = 20_000;
/** Windows with an unchanged tier before the probe may stop early: the third repeats the second. */
export const STABLE_WINDOWS = 3;
/** Idle, or this many ms, whichever first: past the paint burst, before the user has formed an impression. */
export const IDLE_TIMEOUT_MS = 1_500;
/** After this many re-probes landing on the same answer the device has said what it is. */
export const REARM_CAP = 3;
/** The DECLARED default for the unmeasured state — the rung we would ship to everyone if measurement were impossible. Not the top tier by omission: load-visible effects mount here and step UP, so the first transition is an arrival. */
export const DEFAULT_TIER: Tier = "reduced";

export type Phase = "short-circuited" | "unmeasured" | "sampling" | "settled";
export type Verdict = "good" | "neutral" | "bad" | "catastrophic" | "discarded";
export type Preference = "auto" | "full" | "floor";
export type Rearm = "foreground" | "heavier-view";
export type WindowResult = { n: number; kind: WindowKind; samples: number[]; p90: number; mean: number; verdict: Verdict; from: Tier; to: Tier; run: number };

export type ProbeState = {
  phase: Phase;
  tier: Tier;
  /** Why the current tier holds — distinguishes "unmeasured, declared default" from "measured full". */
  tierSource: "preference" | "declared-default" | "measured";
  upgradeRun: number;
  stableRun: number;
  elapsedMs: number;
  windows: WindowResult[];
  closed: number;
  settledBy: "stability" | "deadline" | null;
  rearms: number;
  deferral: { requested: boolean; wonBy: "idle" | "timeout" | null };
  cursor: number;
};

export type ProbeAction =
  | { type: "schedule"; preference: Preference; reducedMotion: boolean }
  | { type: "fire"; winner: "idle" | "timeout" }
  | { type: "window"; kind: WindowKind; straddled?: boolean }
  | { type: "tick" }
  | { type: "rearm"; reason: Rearm };

const LOG_CAP = 8;

/** A high percentile over the window — the statistic is about the bad frames. */
export function percentile(samples: number[], q = PERCENTILE): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function verdictFor(p90: number): Exclude<Verdict, "discarded"> {
  if (p90 >= CATASTROPHIC_MS) return "catastrophic";
  if (p90 >= DOWNGRADE_MS) return "bad";
  if (p90 < UPGRADE_MS) return "good";
  return "neutral";
}

/** The probe before anything is scheduled; `schedule` decides whether it is created at all. */
export function initialProbe(preference: Preference, reducedMotion: boolean): ProbeState {
  const base: ProbeState = {
    phase: "unmeasured", tier: DEFAULT_TIER, tierSource: "declared-default", upgradeRun: 0, stableRun: 0, elapsedMs: 0,
    windows: [], closed: 0, settledBy: null, rearms: 0, deferral: { requested: false, wonBy: null }, cursor: 0,
  };
  // The short-circuit sits BEFORE the scheduling: no idle request, no timer, no buffer, no windows.
  if (reducedMotion) return { ...base, phase: "short-circuited", tier: PREFERENCE_TIER["reduced-motion"], tierSource: "preference" };
  if (preference !== "auto") return { ...base, phase: "short-circuited", tier: PREFERENCE_TIER[preference], tierSource: "preference" };
  return { ...base, deferral: { requested: true, wonBy: null } };
}

function closeWindow(s: ProbeState, kind: WindowKind, straddled: boolean): ProbeState {
  if (s.phase !== "sampling") return s;
  const n = s.closed + 1;
  const samples = windowSamples(kind, n, s.tier, WINDOW_SAMPLES);
  const p90 = percentile(samples);
  const mean = Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10;
  const elapsedMs = s.elapsedMs + samples.reduce((a, b) => a + b, 0);
  // A window spanning a visibility change reports a stopped clock, not a slow frame: discard it. It
  // does not decide, and it does not count toward stability either.
  if (straddled) {
    const w: WindowResult = { n, kind, samples, p90, mean, verdict: "discarded", from: s.tier, to: s.tier, run: s.upgradeRun };
    return { ...s, closed: n, elapsedMs, windows: [w, ...s.windows].slice(0, LOG_CAP) };
  }
  const verdict = verdictFor(p90);
  let tier = s.tier;
  let run = s.upgradeRun;
  if (verdict === "catastrophic") { tier = "floor"; run = 0; } // a downgrade may skip rungs
  else if (verdict === "bad") { tier = stepDown(s.tier); run = 0; } // one bad window, immediately
  else if (verdict === "good") {
    run += 1; // the ONE increment path
    if (run >= UPGRADE_RUN) { tier = stepUp(s.tier); run = 0; } // an upgrade is one rung at a time
  } else run = 0; // the dead band: neither good nor bad, and it RESETS the counter
  const changed = tier !== s.tier;
  const stableRun = changed ? 0 : s.stableRun + 1;
  const w: WindowResult = { n, kind, samples, p90, mean, verdict, from: s.tier, to: tier, run };
  const next: ProbeState = { ...s, tier, tierSource: "measured", upgradeRun: run, stableRun, elapsedMs, closed: n, windows: [w, ...s.windows].slice(0, LOG_CAP) };
  // The stopping rule: stability first (the ordinary exit), then the unconditional deadline.
  if (stableRun >= STABLE_WINDOWS) return { ...next, phase: "settled", settledBy: "stability" };
  if (elapsedMs >= SETTLE_MS) {
    // Unsettled at the deadline: resolve to the LOWER of the tiers it flapped between, and stop.
    const recent = next.windows.slice(0, STABLE_WINDOWS + 1).map((x) => x.to);
    const resolved = recent.reduce(lowerTier, tier);
    return { ...next, tier: resolved, phase: "settled", settledBy: "deadline" };
  }
  return next;
}

export function probeReducer(s: ProbeState, a: ProbeAction): ProbeState {
  switch (a.type) {
    case "schedule":
      return initialProbe(a.preference, a.reducedMotion);
    case "fire":
      // Whichever path wins cancels the other; a re-arm samples straight away and never comes here.
      if (s.phase !== "unmeasured") return s;
      return { ...s, phase: "sampling", deferral: { requested: true, wonBy: a.winner } };
    case "window":
      return closeWindow(s, a.kind, a.straddled === true);
    case "tick": {
      if (s.phase === "unmeasured") return probeReducer(s, { type: "fire", winner: "idle" });
      if (s.phase !== "sampling") return s;
      const kind = TRACE[s.cursor % TRACE.length];
      return { ...closeWindow(s, kind, false), cursor: s.cursor + 1 };
    }
    case "rearm":
      // Event-shaped, never a poll: a fresh settle budget with its own deadline, budgeted in count.
      if (s.phase !== "settled" || s.rearms >= REARM_CAP) return s;
      return { ...s, phase: "sampling", settledBy: null, stableRun: 0, upgradeRun: 0, elapsedMs: 0, rearms: s.rearms + 1 };
    default:
      return s;
  }
}
