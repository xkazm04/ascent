// The two list bodies of an expanded passport row, extracted from PassportRowDetail to keep that file
// under the 200-LOC cap that governs src/features/** (AGENTS.md). Pure relocation for `BlockerList`;
// `DeclinedList` is the new 0.4.0 half.
//
// No "use client" here on purpose: neither component uses a hook or an event handler. The interactive
// piece is `DecisionControl`, which carries its own directive.
//
// WHY TWO LISTS. Passport 0.4.0 made a decline decision memory rather than a deletion: the overlay
// retires an accepted gap from `blockers` and re-emits it under `passport.declined`. Rendering only
// `blockers` therefore made every accepted gap INVISIBLE — the reader could not tell "this repo has no
// error tracking, and the owner decided that's fine" from "this repo has error tracking". An accepted
// gap is still a gap; it is the *judgment* that differs, so it gets its own list rather than being
// dropped or silently folded back in with the open ones.
//
// A RE-SURFACED decline (kind changed / severity rose / aged past DECLINE_MAX_AGE_DAYS) appears in BOTH
// lists, which is correct and deliberate: the overlay left the blocker open because the accepted risk
// was accepted about a different repo than the one that exists now. The entry says so, so the duplicate
// reads as "this is the reasoning you are being asked to reaffirm", not as a double-count.

import { DecisionControl } from "@/components/org/DecisionControl";
import { blockerKey } from "@/lib/org/findings";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { DeclinedByChoice } from "@/lib/types";

// Each blocker is a decidable finding: fix it, or record why it doesn't apply here. Both axes share
// one key space (blockerKey hashes the repo + the normalized blocker text), so a blocker listed on
// both automation and production is ONE decision, made once, reflected in both lists.
export function BlockerList({
  title,
  items,
  allClear,
  org,
  fullName,
  decisions,
}: {
  title: string;
  items: string[];
  allClear: string;
  org: string;
  fullName: string;
  decisions: DecisionMap;
}) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-emerald-400/80">{allClear}</p>
      ) : (
        <ul className="mt-1.5 space-y-2.5">
          {items.map((b) => {
            const key = blockerKey(fullName, b);
            const decision = decisions[key];
            return (
              <li key={b} className={`text-sm text-slate-300 ${decision && decision.status !== "open" ? "opacity-60" : ""}`}>
                <span className="flex gap-2">
                  <span aria-hidden className="mt-0.5 shrink-0 text-orange-400">▸</span>
                  {b}
                </span>
                <div className="ml-4 mt-1.5">
                  <DecisionControl
                    org={org}
                    module="passports"
                    itemKey={key}
                    title={b}
                    status={decision?.status ?? "open"}
                    rationale={decision?.rationale}
                    decidedBy={decision?.decidedBy}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The owner's accepted gaps (`passport.declined`, 0.4.0). Muted relative to the open blockers above —
 *  a decision is not a to-do — except when it needs re-confirming, which is the one state that wants
 *  the reader's eye. */
export function DeclinedList({ items }: { items: DeclinedByChoice[] }) {
  if (items.length === 0) return null;
  const stale = items.filter((d) => d.needsReconfirm).length;
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">
        Accepted by choice
        {stale > 0 && <span className="ml-2 text-amber-400">{stale} need re-confirmation</span>}
      </div>
      <ul className="mt-1.5 space-y-2.5">
        {items.map((d) => (
          <li key={d.path} className="text-sm">
            <span className="flex gap-2">
              <span aria-hidden className={`mt-0.5 shrink-0 ${d.needsReconfirm ? "text-amber-400" : "text-slate-600"}`}>
                {d.needsReconfirm ? "!" : "◇"}
              </span>
              <span className="min-w-0">
                <span className="text-slate-400">{d.label}</span>
                {d.at && <span className="font-mono text-xs text-slate-600"> · declined {d.at}</span>}
                {d.needsReconfirm && (
                  <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-400">
                    needs re-confirmation
                  </span>
                )}
                {d.blocker && <span className="mt-0.5 block text-slate-500">{d.blocker}</span>}
                {d.reason && <span className="mt-0.5 block italic text-slate-500">&ldquo;{d.reason}&rdquo;</span>}
                {d.needsReconfirm && (
                  <span className="mt-1 block text-amber-400/90">
                    {d.reconfirmReason} It is listed as an open blocker above until it is re-confirmed.
                  </span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
