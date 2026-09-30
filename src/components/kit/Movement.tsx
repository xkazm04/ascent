// Movement — a signed points delta as an arrow glyph plus magnitude, with its basis printed beside it and a
// spoken sentence for screen readers. The glyph is decoration (screen readers voice arrows inconsistently);
// the sr-only text is the channel. Renders nothing for a zero or missing delta: the caller decides whether
// "held" or "no measurement" needs its own mark (see VoidMark). Colour is the fleet's direction triad
// (`deltaHex`, noise-muted) unless the caller pins a `toneClass`.
import { deltaHex } from "@/components/ui/format";

export function Movement({
  delta,
  basis,
  title,
  toneClass,
  basisClass = "",
  className = "",
}: {
  delta: number | null | undefined;
  /** The window the move was measured over ("vs last week"): printed, never tooltip-only. */
  basis?: string | null;
  title?: string;
  /** Pins the glyph colour to a class (Altimeter strips) instead of the direction-triad inline style. */
  toneClass?: (up: boolean) => string;
  basisClass?: string;
  className?: string;
}) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  const abs = Math.abs(delta);
  return (
    <span data-kit="movement" data-role="movement" data-dir={up ? "up" : "down"} title={title} className={className}>
      <span aria-hidden className={toneClass ? toneClass(up) : undefined} style={toneClass ? undefined : { color: deltaHex(delta) }}>
        {up ? "▲" : "▼"}
        {abs}
      </span>
      {basis && <span className={`ml-1 ${basisClass}`.trim()}>{basis}</span>}
      <span className="sr-only">
        {up ? "up" : "down"} {abs} points {basis ?? "this period"}
      </span>
    </span>
  );
}
