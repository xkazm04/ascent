// THE OBSERVATORY THEATER'S BUDGET — every duration, distance and cap the sky moves by, in one place
// (`motion/taste-budgets`: a budget is a constant beside the presets it governs, never a memory).
//
// Units: geometry is in SVG USER UNITS over a viewBox `SKY_VB_W` wide, so the whole sky — type
// included — scales with the screen (1.33× at 1920 px wide, 2.67× at 3840: the brand's display-lg
// 37 renders at 49 px and 99 px). Durations are milliseconds.
//
// THE MOTION CLASSES this hero spends, and the real event behind each (nothing else moves):
//   entrance     a tail particle appears   ← a new LaneActivity in the pulse (once per identity)
//   transition   the tail shifts one slot  ← the same new event pushing older ones back
//   transition   a body glides ring→ring   ← the repo's runner state changed (slot won, lane done, paused)
//   transition   the phase / file re-labels← the lane's phase or last-touched file changed
//   celebratory  a body flares once        ← a `landed` / `verified-close` event ARRIVED while open
//   decay        particles and glow cool   ← time since each event (`now - at`); frozen when stale
//   ambient      none. The stars are still; nothing loops.

/** The viewBox width every coordinate is laid out in. Its height follows the hero's aspect. */
export const SKY_VB_W = 1440;
/** Bounds on the viewBox height, so a very flat or very tall slot still lays out. */
export const SKY_VB_H_MIN = 480;
export const SKY_VB_H_MAX = 1400;
/** The viewBox height before the hero has been measured (1920×785, the 1080p hero slot). */
export const SKY_VB_H_DEFAULT = 589;
/** The narrated line's band under the sky. */
export const NARRATION_BAND = 92;

/** Ring radii along x: at work · next up · resting. The y radius follows one perspective ratio. */
export const RING_RX: readonly [number, number, number] = [250, 470, 660];
export const RING_TILT_MAX = 0.42;

// ── the comet tail ─────────────────────────────────────────────────────────────────────────────
/** Events a lane's accumulator keeps (the pulse window is 6; the tail is what this screen saw). */
export const TAIL_KEEP = 28;
/** Arc distance from the nucleus to the newest particle, and between particles. */
export const TAIL_HEAD_GAP = 22;
export const TAIL_STEP = 15;
/** Longest tail, in arc units; shortened further so it never reaches the next body behind it. */
export const TAIL_MAX_LEN = 440;
/** A particle's brightness halves every this long — an idle lane visibly cools. */
export const FADE_HALF_LIFE_MS = 60_000;
/** Below this brightness a particle is not drawn at all. */
export const FADE_FLOOR = 0.05;
/** Perpendicular spray: base and per-slot widening. */
export const SPRAY_BASE = 3;
export const SPRAY_PER_SLOT = 0.32;

// ── durations ──────────────────────────────────────────────────────────────────────────────────
/** A new particle's entrance (scale + opacity). */
export const PARTICLE_ENTER_MS = 380;
/** Older particles sliding back one slot when a new event lands at the head. */
export const PARTICLE_SHIFT_MS = 620;
/** The decay step between clock ticks is eased over this, so cooling is continuous, not stepped. */
export const FADE_TICK_MS = 1_000;
/** Phase word / file label cross-fade on change. */
export const LABEL_FADE_MS = 420;
/** How long a flare element stays mounted after its event arrived (the ring itself runs 0.9 s). */
export const FLARE_HOLD_MS = 2_500;
/** The narration says "just landed" for this long after a landing. */
export const JUST_LANDED_MS = 30_000;
/** At most this many halo rings, however many landings a repo had today. */
export const HALO_MAX = 3;
/** A body grows by this fraction per halo ring. */
export const HALO_GROWTH = 0.09;

// ── bodies ─────────────────────────────────────────────────────────────────────────────────────
export const NUCLEUS_R = 11;
export const GLOW_R = 52;
export const WAITING_R = 7.5;
export const RESTING_R = 6;
/** Minimum angular separation on the outer rings, degrees. */
export const RING_MIN_SEP: readonly [number, number, number] = [0, 16, 12];
