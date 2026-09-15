// The one inline share meter the Contributors tab uses (champions, per-person AI share, top-share).
// Server-safe.
//
// It now speaks the /org state vocabulary. A share is only a MEASUREMENT when something was measured
// to take the share OF: a contributor with no commits in the window, and a repo with no attributed
// commit data at all, both used to render an identical `0%` bar — a filled track at zero, which reads
// as "we looked and the answer was none". That is a claim the data never made, and the distinction
// was invisible on screen (§2.4: an absence is never a zero). A non-finite / null `pct` now renders
// the `missing` void — the broken-rule swatch and an em dash — with the caveat on hover/focus.

import { MeterRow } from "@/components/org/shared/ui";
import { StateSwatch, isNum, stateTitle } from "@/components/org/viz";

export function AiBar({
  pct,
  color,
  label = "AI share",
}: {
  /** 0..100. Null / non-finite ⇒ no measurement — rendered as a void, never as a 0% bar. */
  pct: number | null | undefined;
  color?: string;
  /** Subject naming this bar, used in the void's generated title. Keep it a noun phrase. */
  label?: string;
}) {
  if (!isNum(pct)) {
    return (
      <span className="inline-flex items-center gap-1.5" title={stateTitle("missing", label)}>
        <StateSwatch state="missing" />
        <span className="type-mono-sm text-slate-600" aria-hidden>
          —
        </span>
      </span>
    );
  }
  return <MeterRow layout="inline" value={pct} display={`${pct}%`} color={color} meterClassName="w-24" ariaLabel={label} />;
}
