// The public, data-free constellation — the /launch star field rendered on a page anyone can reach.
//
// Deliberately NOT a client component: it holds no state, no effects and no handlers, so it renders
// entirely on the server and adds zero JavaScript to whatever page embeds it. Every star's position,
// size and color comes from `publicStars` (which in turn drives the live map's own `starPosition` /
// `starLook`), so the tone is identical to Mission Control without a single byte of fleet data.
//
// Motion: reuses the existing `.launch-star` / `.launch-glow` classes, which globals.css already
// zeroes out under `prefers-reduced-motion` — so this inherits the gate rather than re-declaring it.

import type { CSSProperties } from "react";
import { ACCENT, CENTER, CORE } from "./fleetMapStars";
import { PUBLIC_STAR_COUNT, publicStars } from "./publicStars";

export function PublicConstellation({
  count = PUBLIC_STAR_COUNT,
  className = "",
  label = "An illustrative constellation: each star a repository, brighter with higher AI-native maturity",
}: {
  /** How many decorative stars to place (clamped by publicStars to PUBLIC_STAR_MAX). */
  count?: number;
  className?: string;
  /** Accessible name for the figure. It is decorative data, so the label says so plainly. */
  label?: string;
}) {
  const stars = publicStars(count);
  return (
    // role="img" is correct HERE (unlike the live map, whose stars are per-repo links): there is
    // nothing interactive inside, so collapsing the whole field to one labelled image is exactly
    // what a screen reader should get instead of 64 meaningless circles.
    <svg
      viewBox="0 0 120 120"
      className={`h-full w-full ${className}`}
      role="img"
      aria-label={label}
    >
      {/* constellation lines from the core out to each "scanned" star */}
      {stars.map((s) =>
        s.score == null ? null : (
          <line
            key={`l-${s.key}`}
            x1={CENTER}
            y1={CENTER}
            x2={s.cx}
            y2={s.cy}
            stroke={s.color}
            strokeWidth={0.4}
            opacity={0.12 + (s.score / 100) * 0.28}
          />
        ),
      )}

      {stars.map((s) => {
        const style: CSSProperties = {
          ["--star-opacity" as string]: s.opacity,
          animationDelay: s.delay,
        };
        return <circle key={`d-${s.key}`} className="launch-star" cx={s.cx} cy={s.cy} r={s.r} fill={s.color} style={style} />;
      })}

      {/* the core beacon — the same pulsing org star the live map centers each cluster on */}
      <circle className="launch-glow" cx={CENTER} cy={CENTER} r={7} fill={ACCENT} opacity={0.4} />
      <circle cx={CENTER} cy={CENTER} r={2.6} fill={CORE} />
    </svg>
  );
}
