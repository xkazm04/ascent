import type { ReactNode } from "react";

/**
 * The deck's "strata + accent glow behind content" chrome, factored out of the sections that
 * repeated it inline. Renders an aria-hidden `strata` layer and an aria-hidden radial-gradient glow
 * behind a `relative` content wrapper. The per-section tuning (gradient geometry, opacity, whether the
 * layers should be pointer-transparent) is passed in so each call stays visually identical.
 *
 * The OUTER positioned/overflow-hidden container (a plain card div or a <Surface>) stays at the call
 * site, since those differ across sections; this component only owns the two backdrop layers + the
 * relative content wrapper.
 */
export function GlowBackdrop({
  glow,
  strataOpacity,
  pointerEventsNone = false,
  children,
}: {
  /** The radial-gradient `background` value for the glow layer. */
  glow: string;
  /** Tailwind opacity utility for the strata layer (e.g. "opacity-40"). */
  strataOpacity: string;
  /** Add `pointer-events-none` to both backdrop layers. */
  pointerEventsNone?: boolean;
  children: ReactNode;
}) {
  const pe = pointerEventsNone ? "pointer-events-none " : "";
  return (
    <>
      <div aria-hidden className={`strata ${pe}absolute inset-0 ${strataOpacity}`} />
      <div aria-hidden className={`${pe}absolute inset-0`} style={{ background: glow }} />
      <div className="relative">{children}</div>
    </>
  );
}
