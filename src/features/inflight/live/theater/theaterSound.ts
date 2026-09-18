// The theater's sound — the wall's chime voice (liveWarRoomCelebrate.ts), on ONE context unlocked by
// a user gesture.
//
// Browsers refuse audio until the person interacts with the page, so `?sound=1` can only PRESELECT
// sound: the page then says "click anywhere to turn sound on" and the first pointer or key press calls
// `unlockAudio()` inside that gesture. The context is created once and reused — a context created
// inside a gesture stays allowed, where a fresh context per cue (the wall's pattern, fine for a wall
// that is clicked constantly) would be refused on a screen nobody touches for hours.
//
// Sound is gated ONLY by that explicit unlock. Reduced motion governs animation, not audio: someone
// who asked for less movement and turned sound on still asked for sound.

import { CHIME_TONES, scheduleTones } from "../liveWarRoomCelebrate";
import type { CueKind } from "./theaterCues";

/** The attention cue: the chime's own two pitches, FALLING — clearly the same voice, clearly not a win. */
export const ATTENTION_TONES: readonly (readonly [number, number])[] = CHIME_TONES.map(
  ([, at], i) => [CHIME_TONES[CHIME_TONES.length - 1 - i]![0], at] as const,
);

let ctx: AudioContext | null = null;

/** Create/resume the one context. Call from inside a user gesture. False when audio is unavailable. */
export function unlockAudio(): boolean {
  try {
    const Ctx = typeof window !== "undefined" ? window.AudioContext : undefined;
    if (!Ctx) return false;
    ctx ??= new Ctx();
    void ctx.resume().catch(() => {});
    return true;
  } catch {
    ctx = null;
    return false;
  }
}

/** Close the context (sound turned off). Idempotent. */
export function lockAudio(): void {
  const c = ctx;
  ctx = null;
  void c?.close().catch(() => {});
}

/** Play a cue's tones when a context is open. Best-effort: never throws. */
export function playCue(kind: CueKind): void {
  if (!ctx) return;
  try {
    scheduleTones(ctx, kind === "attention" ? ATTENTION_TONES : CHIME_TONES);
  } catch {
    /* audio blocked or torn down — the cue stays visual */
  }
}
