// The motion vocabulary (motion-tokens) and its parity gate (cross-language-token-parity). No React.
//
// Durations are a LADDER of named steps, easings are named by ROLE, and reduced motion is a
// token-layer decision: `ladderFor(true)` rebinds the travel steps to a 1ms epsilon (never exact
// zero, so a transition's completion event still fires) while `instant` (a tint flip, no travel)
// keeps its value. Consumers reference `var(--sx-duration-<step>)` and never check the preference.

export const DURATION_MS = { instant: 60, fast: 120, base: 240, slow: 400, deliberate: 640 } as const;
export type DurationStep = keyof typeof DURATION_MS;
export const STEPS = Object.keys(DURATION_MS) as DurationStep[];

export const STEP_USE: Record<DurationStep, string> = {
  instant: "state flip, no travel: hover tint, focus ring",
  fast: "small element, short travel: toggle, icon swap",
  base: "element-level enter / exit: list row, popover",
  slow: "container-level change: modal, drawer",
  deliberate: "attention choreography: onboarding reveal",
};

export const EASING = {
  enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.7, 0, 0.84, 0)",
  move: "cubic-bezier(0.65, 0, 0.35, 1)",
  expressive: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;
export type EasingRole = keyof typeof EASING;

/** Choreography constants are vocabulary too; scripts derive waits from here, never locally. */
export const STAGGER_MS = 40;
export const REDUCED_EPSILON_MS = 1;

/** Steps that carry travel collapse under reduction; a tint flip has nothing to remove. */
const TRAVEL_STEPS: readonly DurationStep[] = ["fast", "base", "slow", "deliberate"];

export function ladderFor(reduced: boolean): Record<DurationStep, number> {
  const out = { ...DURATION_MS } as Record<DurationStep, number>;
  if (reduced) for (const s of TRAVEL_STEPS) out[s] = REDUCED_EPSILON_MS;
  return out;
}

/** The motion slice of the generated mirror: one door, every consumer of the vocabulary complies. */
export function motionVars(reduced: boolean): Record<string, string> {
  const ladder = ladderFor(reduced);
  const out: Record<string, string> = {};
  for (const s of STEPS) out[`--sx-duration-${s}`] = `${ladder[s]}ms`;
  for (const r of Object.keys(EASING) as EasingRole[]) out[`--sx-ease-${r}`] = reduced && r === "expressive" ? EASING.move : EASING[r];
  return out;
}

/** The "which step?" exercise: a change is categorical, and the ladder answers by what is moving. */
export const CHANGES: readonly { id: string; label: string; step: DurationStep }[] = [
  { id: "tint", label: "hover tint on a chip", step: "instant" },
  { id: "row", label: "a list row entering", step: "base" },
  { id: "modal", label: "a modal opening", step: "slow" },
];

// ── Parity: the same ladder consumed from the scripting layer ───────────────────────────────────

export type ParityStatus = "parity" | "drift" | "broken";
export type ParityReport = { status: ParityStatus; findings: string[]; members: number };

/**
 * Strategy 3, the gated mirror: both copies enumerated, same members and same values, and the gate
 * refuses to report parity when either side is empty (a checker that parsed nothing has not checked
 * anything: failure-not-empty-success).
 */
export function parityCheck(authority: Record<string, number>, mirror: Record<string, number>): ParityReport {
  const a = Object.keys(authority);
  const m = Object.keys(mirror);
  if (a.length === 0 || m.length === 0) {
    return { status: "broken", members: 0, findings: [`instrument read ${a.length} authority and ${m.length} mirror members: refusing to report`] };
  }
  const findings: string[] = [];
  for (const k of a) {
    if (!(k in mirror)) findings.push(`${k}: missing from the mirror`);
    else if (mirror[k] !== authority[k]) findings.push(`${k}: authority ${authority[k]}ms, mirror ${mirror[k]}ms`);
  }
  for (const k of m) if (!(k in authority)) findings.push(`${k}: phantom, exists only in the mirror`);
  return { status: findings.length ? "drift" : "parity", members: a.length, findings };
}
