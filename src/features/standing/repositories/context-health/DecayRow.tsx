// One repository's row in the half-life ledger — extracted from ContextHalfLife.tsx for the 200-LOC
// features cap, and re-stated in the shared vocabulary while it moved.
//
// The row used to paint every un-measurable state with one hand-picked slate hex and a word
// ("not assessed" / "no context"), which made an unjudged repo look like a badly-scoring one at a
// glance. It now carries the kit's own mark: a hatch for a repo nobody judged, a void for a repo
// with no guidance file to judge — and, because `rendersValue` is false for both, the potency column
// prints an em dash rather than a number by construction (docs/ORG-UX-REDESIGN.md §2.4).
//
// Server-safe: no hooks, no handlers.

import Link from "next/link";
import { StateSwatch, rendersValue, type VizState } from "@/components/org/viz";
import { scoreHex, fmtCompact } from "@/lib/ui";
import { days } from "./contextDecayViz";
import type { RepoContextRow } from "./contextHealthModel";
import { HalfLifeCurve } from "./HalfLifeCurve";

/** The row's epistemic state: what we know about this repo's context layer, not how good it is. */
export function rowState(r: RepoContextRow): VizState {
  if (!r.assessed) return "not-judged";
  if (!r.present) return "missing";
  if (r.potency == null) return "not-judged";
  return "measured";
}

export function DecayRow({ r }: { r: RepoContextRow }) {
  const state = rowState(r);
  const measured = state === "measured";
  const hex = measured && r.potency != null ? scoreHex(r.potency) : undefined;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-ink px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_9rem_auto] ${
        measured ? "" : "opacity-70"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {r.scanned ? (
            <Link href={`/report/${r.fullName}`} className="truncate type-mono-sm text-white hover:text-accent">
              {r.fullName}
            </Link>
          ) : (
            <span className="truncate type-mono-sm text-slate-400">{r.fullName}</span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1.5">
            {!measured && <StateSwatch state={state} />}
            <span className="type-label tracking-[0.18em]" style={hex ? { color: hex } : undefined}>
              {measured ? r.primaryPath : !r.assessed ? "not assessed" : r.potency == null ? "freshness unknown" : "no context"}
            </span>
          </span>
        </div>
        <p className="mt-1 truncate type-body-sm text-slate-400">{r.verdict}</p>
      </div>

      <div className="hidden sm:block">
        {measured && r.potency != null ? (
          <HalfLifeCurve potency={r.potency} ariaLabel={`${r.name} context potency ${r.potency}%`} />
        ) : (
          <span aria-hidden className="block h-[34px]" />
        )}
      </div>

      <div className="flex items-center gap-5 text-right">
        <div>
          <div className="font-mono type-lede tabular-nums" style={hex ? { color: hex } : undefined}>
            {/* The guard, not a convention: a state that renders no value cannot print one here. */}
            {rendersValue(state) && r.potency != null ? `${r.potency}%` : "—"}
          </div>
          <div className="type-label tracking-[0.18em] text-slate-600">potency</div>
        </div>
        <div className="w-16">
          <div className="font-mono type-lede tabular-nums text-slate-300">
            {r.assessed && r.present && r.halfLifeDays != null ? days(r.halfLifeDays) : "—"}
          </div>
          <div className="type-label tracking-[0.18em] text-slate-600">½-life</div>
        </div>
        <div className="hidden w-20 md:block">
          <div className="font-mono type-lede tabular-nums text-slate-300">
            {r.commitsSinceEdit != null ? `≈${fmtCompact(r.commitsSinceEdit)}${r.windowCapped ? "+" : ""}` : "—"}
          </div>
          <div className="type-label tracking-[0.18em] text-slate-600">commits since</div>
        </div>
      </div>
    </div>
  );
}
