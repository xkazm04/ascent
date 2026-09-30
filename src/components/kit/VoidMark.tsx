// VoidMark — the one mark for "nothing was measured here": the broken-rule StateSwatch under a role=img
// wrapper that carries the spoken label and the shared caveat on hover. An absence is never a zero and never
// a bare dash; every surface draws it from here so a redesign of the void reaches all of them. `boxed` frames
// it in a heatmap-cell sized outline. Server-safe; no hooks.
import { StateSwatch } from "@/components/org/viz/StateSwatch";
import { stateTitle } from "@/components/org/viz/states";

export function VoidMark({
  subject,
  label,
  size = 12,
  boxed = false,
  className = "",
}: {
  /** What is absent ("Fleet average · D3"): prefixes the tooltip. */
  subject?: string;
  /** Spoken label. Defaults to the state title for `subject`. */
  label?: string;
  size?: number;
  boxed?: boolean;
  className?: string;
}) {
  const title = stateTitle("missing", subject);
  return (
    <span
      data-kit="void-mark"
      data-role="void-mark"
      role="img"
      aria-label={label ?? title}
      title={title}
      className={`${boxed ? "mx-auto flex h-7 w-9 items-center justify-center rounded border border-divider/60" : "inline-flex"} ${className}`.trim()}
    >
      <StateSwatch state="missing" size={size} />
    </span>
  );
}
