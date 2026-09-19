// The PUBLIC, data-free star field.
//
// /launch is session-gated AND robots-disallowed, so the constellation — the product's most
// tone-setting surface — was only ever visible AFTER sign-in. The co-located
// `app/launch/opengraph-image.tsx` already proved a fleet map can be rendered with ZERO data by
// driving the real `starPosition` phyllotaxis with a synthetic seed; this module makes that same
// trick reusable on a public page (the landing deck's fleet section).
//
// Rules this module exists to keep:
//  - It FORKS NOTHING. Placement comes from `starPosition`, brightness/size/color from `starLook`,
//    the palette from the shared ACCENT/FAINT/CENTER constants. If the live map's math changes,
//    the public field changes with it.
//  - It is PURE and DETERMINISTIC — index-derived pseudo-maturity, no Math.random, no Date, no
//    fetch — so the server and client renders agree byte for byte (no hydration mismatch) and the
//    section costs the page zero requests.
//  - It carries NO DATA. Nothing here reads a scan, a session, or an org. The stars are decorative
//    by construction, so there is nothing to leak on a public route.

import { starLook, starPosition } from "./fleetMapStars";

/** Seed prefix for the synthetic field. Matches the OG card's `ascent-fleet-${i}` convention so the
 *  shared social image and the landing section are literally the same sky. */
export const PUBLIC_SEED = "ascent-fleet";

/** Default star count for the public field. Deliberately far below the dashboard's DENSE_FLEET_STARS
 *  (240) cap — this is a marketing vignette on a page that must stay light, not a fleet readout. */
export const PUBLIC_STAR_COUNT = 64;

/** Hard ceiling on what `publicStars` will ever emit, so a caller (or a future edit) can't grow the
 *  landing page's DOM without tripping the test that pins this. */
export const PUBLIC_STAR_MAX = 96;

export interface PublicStar {
  /** Stable React key / synthetic seed for this star. */
  key: string;
  cx: number;
  cy: number;
  /** Painted radius (from starLook). */
  r: number;
  color: string;
  opacity: number;
  /** Deterministic twinkle offset so the field shimmers unevenly without any randomness. */
  delay: string;
  /** Pseudo-maturity, or null for a decorative "not yet scanned" star. Drives the core-to-star line. */
  score: number | null;
}

/** Deterministic pseudo-maturity for star `i`. The `* 41 % 100` walk (inherited from the OG card)
 *  spreads the level ramp evenly across the field; every 7th star is left UNSCANNED so the public
 *  sky reads like a real fleet mid-climb — faint greys among the lit ones — rather than a uniformly
 *  bright brochure render. */
export function publicStarScore(i: number): number | null {
  return i % 7 === 0 ? null : (i * 41) % 100;
}

/** Build the public field. Pure: same `count` ⇒ identical output, forever. */
export function publicStars(count: number = PUBLIC_STAR_COUNT): PublicStar[] {
  const total = Math.max(0, Math.min(Math.floor(count), PUBLIC_STAR_MAX));
  return Array.from({ length: total }, (_, i) => {
    const seed = `${PUBLIC_SEED}-${i}`;
    const { cx, cy } = starPosition(i, total, seed);
    const score = publicStarScore(i);
    // starLook already handles null (the live map's "not scanned" look) — never re-derive it here.
    const look = starLook(score);
    return {
      key: seed,
      cx,
      cy,
      r: look.r,
      color: look.color,
      opacity: look.opacity,
      delay: `${(i % 7) * 0.28}s`,
      score,
    };
  });
}
