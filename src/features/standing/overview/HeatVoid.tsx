// The heatmap's void mark — the cell a repository has no measurement for.
//
// Extracted so the grid and its fleet-average footer draw the SAME absence from one place: the pair
// used to be a red `0` in the body and an em dash in the footer, two glyphs for one fact and neither
// of them distinguishable from a score. It is a `role="img"` span rather than a button because there
// is no per-dimension detail to open for a measurement that was never taken, and an enabled control
// would promise one. Server-safe; no hooks.

import { StateSwatch, stateTitle } from "@/components/org/viz";

export function HeatVoid({ subject, label, boxed = true }: { subject: string; label: string; boxed?: boolean }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={stateTitle("missing", subject)}
      className={boxed ? "mx-auto flex h-7 w-9 items-center justify-center rounded border border-divider/60" : "inline-flex"}
    >
      <StateSwatch state="missing" size={12} />
    </span>
  );
}
