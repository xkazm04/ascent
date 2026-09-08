// Symbol-first inline legend for the /org viz kit. Server-safe.
//
// Two rules it exists to enforce:
//  1. The legend shows the REAL symbol (StateSwatch paints from the same `stateFill`/`stateStroke`
//     the chart does), never a coloured square approximating it.
//  2. The caller passes only the states PRESENT in its data. A static six-row legend teaches the
//     reader six encodings for a chart that uses two, which is the prose problem in another costume
//     — the same reason RadarChart's zero-mark legend renders only when something scored zero.
//
// The one-sentence caveat rides along as the row's `title` (and the swatch's aria-label), so the
// demoted A2 prose is reachable on hover/focus and absent at first sight.

import { Kicker } from "@/components/ui";
import { StateSwatch } from "@/components/org/viz/StateSwatch";
import { STATE_HINT, STATE_LABEL, type VizState } from "@/components/org/viz/states";

/** A domain-specific legend row — a mark this chart draws that is not one of the six states. */
export type LegendExtra = {
  id: string;
  label: string;
  /** The real mark, at swatch scale. Pass the same element the chart draws. */
  swatch: React.ReactNode;
  /** The one-sentence caveat, surfaced on hover/focus. */
  hint?: string;
};

export function Legend({
  states = [],
  extra = [],
  baseColor,
  className = "",
}: {
  /** Only the states actually present in this chart's data, in the order the chart uses them. */
  states?: VizState[];
  extra?: LegendExtra[];
  /** Score-derived paint for the swatches where the chart has one. */
  baseColor?: string;
  className?: string;
}) {
  // De-dupe while preserving caller order: a chart that passes ["measured","measured","declared"]
  // straight from its rows gets two rows, not three.
  const seen = new Set<VizState>();
  const rows = states.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
  if (rows.length === 0 && extra.length === 0) return null;

  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}>
      {rows.map((s) => (
        <li key={s} className="flex items-center gap-1.5" title={STATE_HINT[s]}>
          <StateSwatch state={s} baseColor={baseColor} />
          <Kicker tone="muted" as="span">
            {STATE_LABEL[s]}
          </Kicker>
        </li>
      ))}
      {extra.map((e) => (
        <li key={e.id} className="flex items-center gap-1.5" title={e.hint}>
          {e.swatch}
          <Kicker tone="muted" as="span">
            {e.label}
          </Kicker>
        </li>
      ))}
    </ul>
  );
}
