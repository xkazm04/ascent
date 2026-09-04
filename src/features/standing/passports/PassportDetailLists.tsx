// The two list bodies of an expanded passport row, extracted from PassportRowDetail to keep that file
// under the 200-LOC cap that governs src/features/** (AGENTS.md). Pure relocation for `BlockerList`;
// `DeclinedList` is the new 0.4.0 half.
//
// No "use client" here on purpose: neither component uses a hook or an event handler. The interactive
// pieces are `DecisionControl` (judge the finding) and `DeclineControl` (accept the gap by choice),
// each of which carries its own directive.
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
import { DeclineControl } from "./DeclineControl";
// Imported from the overlay module directly, not through the `@/lib/analyze/passport` barrel: these
// components render inside a client tree, and the barrel would drag the whole scan analyzer into the
// bundle. passport-overlay is a pure module (types + one pure score derivation), so it costs nothing.
import { declinablePathForFinding } from "@/lib/analyze/passport-overlay";
import { passportFindingKeys } from "@/lib/org/findings";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { DeclinedByChoice, PassportFinding } from "@/lib/types";

// Each blocker is a decidable finding: fix it, or record why it doesn't apply here. Both axes share
// one key space, so a blocker listed on both automation and production is ONE decision, made once,
// reflected in both lists.
//
// THE KEY IS THE MINTED FINDING ID, not the sentence. `passportFindingKeys` is the same derivation the
// nav badge uses — deliberately imported rather than re-derived, because two derivations of a decision
// key is the same bug as none, found later. It returns [idKey, legacyProseKey]: the row READS both so
// a decision recorded before 0.4.0 keeps resolving, and WRITES the id key, which migrates that
// decision forward the next time anyone touches it.

/** One rendered blocker line: a 0.4.0 finding, or the bare sentence a pre-0.4.0 row has. */
type BlockerRow = Partial<PassportFinding> & { text: string };

export function BlockerList({
  title,
  items,
  findings,
  allClear,
  org,
  fullName,
  decisions,
}: {
  title: string;
  /** The rendered sentences. Used only when `findings` is absent (a pre-0.4.0 stored passport). */
  items: string[];
  /** 0.4.0: the same lines WITH minted ids. Preferred when present — the id is both the decision key
   *  and what says whether the gap may be declined by choice, and it can disagree in length with
   *  `items` for a blob whose two halves drifted, so the finding wins and its own text is rendered. */
  findings?: PassportFinding[];
  allClear: string;
  org: string;
  fullName: string;
  decisions: DecisionMap;
}) {
  const rows: BlockerRow[] = findings ?? items.map((text) => ({ text }));
  return (
    <div>
      <div className="type-label tracking-widest text-slate-500">{title}</div>
      {rows.length === 0 ? (
        <p className="mt-1.5 type-body-sm text-emerald-400/80">{allClear}</p>
      ) : (
        <ul className="mt-1.5 space-y-2.5">
          {rows.map((f) => {
            const [key, legacyKey] = passportFindingKeys(fullName, f);
            const decision = decisions[key!] ?? (legacyKey ? decisions[legacyKey] : undefined);
            // Only an ALLOW-LISTED gap may be declined. An evidence limitation (the tokenless
            // branch-protection caveat) and an unclassified back-fill both land here as null, and get
            // no control at all: declining them would silence a limit of the evidence, not accept a
            // real trade-off.
            const declinePath = declinablePathForFinding(f.id);
            return (
              <li key={key} className={`type-body-sm text-slate-300 ${decision && decision.status !== "open" ? "opacity-60" : ""}`}>
                <span className="flex gap-2">
                  <span aria-hidden className="mt-0.5 shrink-0 text-orange-400">▸</span>
                  {f.text}
                </span>
                <div className="ml-4 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <DecisionControl
                    org={org}
                    module="passports"
                    itemKey={key!}
                    title={f.text}
                    status={decision?.status ?? "open"}
                    rationale={decision?.rationale}
                    decidedBy={decision?.decidedBy}
                  />
                  {declinePath && (
                    <DeclineControl mode="decline" repo={fullName} path={declinePath} code={f.code} severity={f.severity} />
                  )}
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
export function DeclinedList({ items, fullName }: { items: DeclinedByChoice[]; fullName: string }) {
  if (items.length === 0) return null;
  const stale = items.filter((d) => d.needsReconfirm).length;
  return (
    <div>
      <div className="type-label tracking-widest text-slate-500">
        Accepted by choice
        {stale > 0 && <span className="ml-2 text-amber-400">{stale} need re-confirmation</span>}
      </div>
      <ul className="mt-1.5 space-y-2.5">
        {items.map((d) => (
          <li key={d.path} className="type-body-sm">
            <span className="flex gap-2">
              <span aria-hidden className={`mt-0.5 shrink-0 ${d.needsReconfirm ? "text-amber-400" : "text-slate-600"}`}>
                {d.needsReconfirm ? "!" : "◇"}
              </span>
              <span className="min-w-0">
                <span className="text-slate-400">{d.label}</span>
                {d.at && <span className="type-caption text-slate-600"> · declined {d.at}</span>}
                {/* A decision must be revisable by the person who made it, or the first one recorded
                    by mistake is permanent. Retract sends `{ [path]: null }` — the route's own
                    retraction — and the gap returns to the open blocker list on refresh. */}
                <DeclineControl mode="retract" repo={fullName} path={d.path} />
                {d.needsReconfirm && (
                  <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 font-mono type-micro uppercase tracking-widest text-amber-400">
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
