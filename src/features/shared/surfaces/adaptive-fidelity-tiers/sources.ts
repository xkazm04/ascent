// Source excerpts for the mechanism drawer — verbatim from the scene's own files (probe.ts,
// budgets.ts, useProbe.ts, StrataField.tsx). String constants so the drawer needs no build step;
// when the code moves, these move with it in the same commit.

export const SRC_MEASURED = `// probe.ts — a high percentile over a fixed-COUNT window; every constant carries its derivation
/** Samples per window: one second at the lowest refresh we design for (60 Hz); long enough that a single 80 ms GC pause sits under the p90 instead of deciding a tier. Fixed in COUNT, not wall-clock … */
export const WINDOW_SAMPLES = 60;
/** Absolute, not a fraction of the panel's budget: two 60 Hz frames (2 × 16.7 ms). … */
export const DOWNGRADE_MS = 33;
export function percentile(samples, q = PERCENTILE) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
// A window spanning a visibility change reports a stopped clock, not a slow frame: discard it.
if (straddled) { /* logged as "discarded"; decides nothing, counts toward nothing */ }
// fixtures.ts — the declared signals exist only to be refused
export const DECLARED_DEVICE = { userAgent: "Mobile Safari", cores: 4, memoryGb: 4, guess: "lean" };`;

export const SRC_ASYMMETRIC = `// probe.ts — one bad window down (catastrophic skips to the floor); N consecutive good windows up one rung;
// the dead band is neither and RESETS the counter
const verdict = verdictFor(p90);
let tier = s.tier;
let run = s.upgradeRun;
if (verdict === "catastrophic") { tier = "floor"; run = 0; }          // a downgrade may skip rungs
else if (verdict === "bad") { tier = stepDown(s.tier); run = 0; }     // one bad window, immediately
else if (verdict === "good") {
  run += 1;                                                            // the ONE increment path
  if (run >= UPGRADE_RUN) { tier = stepUp(s.tier); run = 0; }         // an upgrade is one rung at a time
} else run = 0;                        // the dead band: neither good nor bad, and it RESETS the counter
export function verdictFor(p90) {
  if (p90 >= CATASTROPHIC_MS) return "catastrophic";
  if (p90 >= DOWNGRADE_MS) return "bad";
  if (p90 < UPGRADE_MS) return "good";
  return "neutral";
}`;

export const SRC_SETTLE = `// probe.ts — stability first (the ordinary exit), then the UNCONDITIONAL deadline, resolving DOWN
if (stableRun >= STABLE_WINDOWS) return { ...next, phase: "settled", settledBy: "stability" };
if (elapsedMs >= SETTLE_MS) {
  const recent = next.windows.slice(0, STABLE_WINDOWS + 1).map((x) => x.to);
  const resolved = recent.reduce(lowerTier, tier);
  return { ...next, tier: resolved, phase: "settled", settledBy: "deadline" };
}
// re-arm: event-shaped, never a poll — a fresh budget with its own deadline, budgeted in count
case "rearm":
  if (s.phase !== "settled" || s.rearms >= REARM_CAP) return s;
  return { ...s, phase: "sampling", settledBy: null, stableRun: 0, upgradeRun: 0, elapsedMs: 0, rearms: s.rearms + 1 };
// useProbe.ts — the stop is a teardown: the interval is cleared once the probe settles
const active = playing && state.phase !== "settled" && state.phase !== "short-circuited";
useEffect(() => {
  if (!active) return;
  const id = setInterval(() => dispatch({ type: "tick" }), PLAY_TICK_MS);
  return () => clearInterval(id); // creation names its reaper
}, [active]);`;

export const SRC_DEFERRAL = `// probe.ts — unmeasured is a STATE with a declared default; idle or timeout, the winner cancels the loser
/** The DECLARED default for the unmeasured state — the rung we would ship to everyone if measurement
 *  were impossible. Not the top tier by omission: load-visible effects mount here and step UP … */
export const DEFAULT_TIER: Tier = "reduced";
/** Idle, or this many ms, whichever first: past the paint burst, before the user has formed an impression. */
export const IDLE_TIMEOUT_MS = 1_500;
const base = { phase: "unmeasured", tier: DEFAULT_TIER, tierSource: "declared-default", … };
return { ...base, deferral: { requested: true, wonBy: null } };   // both handles armed
case "fire":
  if (s.phase !== "unmeasured") return s;
  return { ...s, phase: "sampling", deferral: { requested: true, wonBy: a.winner } };
// DeferralRegion.tsx — the handle that did not win reads "cancelled by the winner"
if (won === name) return "fired";
if (won) return "cancelled by the winner";`;

export const SRC_BUDGET = `// budgets.ts — ONE vocabulary; each effect's table beside it, typed against Tier; rows are parameters
export const TIERS = ["full", "reduced", "floor"] as const;
export const STRATA: Record<Tier, StrataRow> = {
  full:    { lines: 12, driftMs: 9_000,  glowPass: true },
  reduced: { lines: 7,  driftMs: 14_000, glowPass: false },
  floor:   { lines: 3,  driftMs: 0,      glowPass: false },   // a REDUCTION, not an absence
};
export const STRATA_LOAD_BEARING = "lines — the per-frame loop is exactly this long";
// StrataField.tsx — allocate once at the top row, draw a prefix, read the row AT RENDER
const ALL_LINES = Array.from({ length: STRATA.full.lines }, …);   // module scope, once
const row = STRATA[tier];       // read where the parameter is used, so a downgrade is seen
const drawn = ALL_LINES.slice(0, row.lines);
<g style={{ animation: drifting ? \`fidelity-drift \${row.driftMs}ms linear infinite\` : "none" }}>`;

export const SRC_PREFERENCE = `// probe.ts — the short-circuit sits BEFORE the scheduling: it decides whether the probe is created
export function initialProbe(preference, reducedMotion) {
  const base = { phase: "unmeasured", tier: DEFAULT_TIER, … };
  if (reducedMotion) return { ...base, phase: "short-circuited", tier: PREFERENCE_TIER["reduced-motion"], tierSource: "preference" };
  if (preference !== "auto") return { ...base, phase: "short-circuited", tier: PREFERENCE_TIER[preference], tierSource: "preference" };
  return { ...base, deferral: { requested: true, wonBy: null } };
}
// useProbe.ts — live in both directions: a change re-creates (or refuses to create) the probe before paint
const key = \`\${preference}:\${reducedMotion}\`;
const [prevKey, setPrevKey] = useState(key);
if (prevKey !== key) {
  setPrevKey(key);
  dispatch({ type: "schedule", preference, reducedMotion });   // a FRESH budget, never a resumption
  if (reducedMotion) setPlaying(false);
}`;
