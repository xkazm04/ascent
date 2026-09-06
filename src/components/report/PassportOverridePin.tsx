// The provenance pin for a production score an OWNER moved (passport 0.4.0, `productionReadiness.
// overridden`).
//
// `rollback` is an owner-asserted fact a scan cannot observe, and asserting it re-derives the
// production score — worth up to +15 weighted points. Before this pin, the lifted number rendered on
// the hero, the card and the CSV in exactly the same form as a measured one, while the decline path in
// the same overlay is explicit that a decision never moves a score. The answer is not to remove the
// override's effect (the owner does know something the scan doesn't); it is to make it VISIBLE, with
// the measurement it moved readable beside it.
//
// No "use client": no hooks, no handlers — so it can be rendered from the server-side PassportCard as
// well as from the client-side hero.

import type { ScoreOverride } from "@/lib/types";
import { bandLabel } from "@/lib/org/passport-display";

/** "+8 by owner override" with the pre-override measurement, the reason, and who/when. */
export function PassportOverridePin({ overridden, className = "" }: { overridden: ScoreOverride | undefined; className?: string }) {
  if (!overridden) return null;
  const { delta, measuredScore, measuredBand, reason, by, at } = overridden;
  const signed = `${delta > 0 ? "+" : ""}${delta}`;
  return (
    <span
      data-testid="passport-override-pin"
      className={`inline-flex flex-wrap items-baseline gap-x-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 type-caption text-amber-300/90 ${className}`}
      title={`This production score was moved by an owner assertion (${reason}), not by a measurement. The scan measured ${measuredScore}/100 (${bandLabel(measuredBand)}).`}
    >
      <span className="font-mono">{signed} by owner override</span>
      <span className="text-slate-500">· {reason}</span>
      <span className="text-slate-500">
        · measured <span className="font-mono text-slate-400">{measuredScore}</span> ({bandLabel(measuredBand)})
      </span>
      {/* An override with no recorded author reads as UNKNOWN — never a fabricated name. */}
      <span className="text-slate-600">· {by ? by : "author unknown"}{at ? ` · ${at}` : ""}</span>
    </span>
  );
}
