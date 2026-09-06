// The scene's motion vocabulary — ONE home for every gesture the instrument panel plays, and the
// taste constants beside them (preset-vocabulary + taste-budgets). No React.
//
// A preset declares intent and reduced fallback ONCE, and timing + character PER TRACK: a track is
// either a duration class + easing role (timed) or physics + a settle bound (continuous). Nothing
// inlines a millisecond — the ladder below is the only place a number lives, which is exactly the
// token family Ascent's globals.css does not have (its keyframes carry literals: `0.5s ease-out`,
// `360ms cubic-bezier(…)`); this file is the deviation made visible.

export const DURATION_MS = { fast: 120, base: 240, deliberate: 480 } as const;
export type DurationClass = keyof typeof DURATION_MS;

export const EASING = {
  enter: "cubic-bezier(0.16, 1, 0.3, 1)", // decelerate
  exit: "cubic-bezier(0.7, 0, 0.84, 0)", // accelerate, one step faster than enter
  move: "cubic-bezier(0.65, 0, 0.35, 1)", // symmetric
  expressive: "cubic-bezier(0.34, 1.56, 0.64, 1)", // THE one overshoot — celebratory class only
} as const;
export type EasingRole = keyof typeof EASING;

/** The budgets, as numbers with an owner: a preset cannot exceed them without editing this file. */
export const BUDGET = {
  entranceCapMs: 1000,
  staggerStepMs: 40,
  staggerCountCap: 8,
  ambientTravelPx: 3,
  ambientPeriodMs: 4000,
  /** Unprompted motion running longer than this owes a visible, operable stop. */
  visibleControlAfterMs: 5000,
} as const;

export type MotionClass = "feedback" | "transition" | "entrance" | "ambient" | "celebratory";
export type ReducedForm = "fade" | "settle" | "still";

export type TimedTrack = { kind: "timed"; property: string; duration: DurationClass; easing: EasingRole };
export type PhysicsTrack = { kind: "physics"; property: string; stiffness: number; damping: number; settleBoundMs: number };
export type Track = TimedTrack | PhysicsTrack;

export type Preset = {
  intent: string;
  cls: MotionClass;
  /** The keyframe name in the scene's <style>. */
  keyframes: string;
  tracks: readonly Track[];
  /** Designed with the motion: what survives when travel is removed. */
  reduced: ReducedForm;
  /** Timing-load-bearing gestures keep their duration under reduction (an invisibility window is not motion). */
  timingLoadBearing?: boolean;
};

export const PRESETS = {
  entrance: {
    intent: "This element is being drawn into existence.",
    cls: "entrance",
    keyframes: "surface-rise",
    tracks: [
      { kind: "timed", property: "opacity", duration: "base", easing: "enter" },
      { kind: "timed", property: "transform: translateY", duration: "base", easing: "enter" },
    ],
    reduced: "fade",
  },
  "success-settle": {
    intent: "This action just succeeded.",
    cls: "celebratory",
    keyframes: "surface-settle",
    tracks: [{ kind: "timed", property: "transform: scale", duration: "deliberate", easing: "expressive" }],
    reduced: "settle",
  },
  "ambient-breathe": {
    intent: "This surface is idle but alive — presence, never progress.",
    cls: "ambient",
    keyframes: "surface-breathe",
    tracks: [{ kind: "timed", property: "transform: translateY (≤ 3px)", duration: "deliberate", easing: "move" }],
    reduced: "still",
  },
  "spring-retarget": {
    intent: "A user-steered element follows its new target from where it is, at the velocity it has.",
    cls: "transition",
    keyframes: "",
    tracks: [{ kind: "physics", property: "transform: translateX", stiffness: 220, damping: 22, settleBoundMs: 800 }],
    reduced: "settle",
  },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

const timedMs = (t: Track): number => (t.kind === "timed" ? DURATION_MS[t.duration] : t.settleBoundMs);

/** The longest track — what the budget audits. */
export function presetMs(name: PresetName): number {
  return Math.max(...PRESETS[name].tracks.map(timedMs));
}

/**
 * The gesture as an inline `animation` shorthand, resolved for the preference AT THE PRESET LAYER:
 * the reduced form is one branch here, never a branch at a call site. `fade` swaps the keyframes
 * for a plain opacity fade; `settle` and `still` collapse to an epsilon (1ms) so any
 * `animationend` a caller awaits still fires — exact zero is a different behaviour, not a faster one.
 */
export function animationFor(name: PresetName, reduced: boolean, opts: { delayMs?: number; loop?: boolean } = {}): string {
  const p = PRESETS[name];
  if (!p.keyframes) return "none";
  const iter = opts.loop ? " infinite alternate" : " both";
  const delay = opts.delayMs ? ` ${opts.delayMs}ms` : "";
  if (!reduced || p.timingLoadBearing) {
    const t = p.tracks[0];
    const ease = t.kind === "timed" ? EASING[t.easing] : EASING.move;
    const ms = opts.loop ? BUDGET.ambientPeriodMs : presetMs(name);
    return `${p.keyframes} ${ms}ms ${ease}${delay}${iter}`;
  }
  if (p.reduced === "fade") return `surface-fade ${DURATION_MS.fast}ms ${EASING.enter}${delay} both`;
  return `${p.keyframes} 1ms linear both`; // settle / still: epsilon, end state on the first frame
}

/** Entrance choreography total: per-item motion plus accumulated stagger, count-capped. */
export function entranceTotalMs(perItemMs: number, count: number): number {
  return perItemMs + BUDGET.staggerStepMs * Math.min(Math.max(count - 1, 0), BUDGET.staggerCountCap - 1);
}

/** The keyframes the presets reference, scoped to the scene via one <style>. */
export const SCENE_KEYFRAMES = `
@keyframes surface-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes surface-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes surface-settle { 0% { transform: scale(1); } 50% { transform: scale(1.08); } 100% { transform: scale(1); } }
@keyframes surface-breathe { from { transform: translateY(0); } to { transform: translateY(-${BUDGET.ambientTravelPx}px); } }
`;
