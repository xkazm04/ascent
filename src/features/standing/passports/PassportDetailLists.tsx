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

import { DecisionControl, type DecisionStatusUi } from "@/components/org/DecisionControl";
import { judgeFinding } from "@/lib/org/passport-judgments";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { DeclinedByChoice, PassportFinding } from "@/lib/types";
import { isDeclinableFinding } from "./passportDeclineOffers";

// A declinable blocker is a decidable finding: fix it, or record why it doesn't apply here. An
// evidence-limit row (unassessable / enforcement-not-observable) stays informational — same
// `isDeclinableFinding` skip `declineOffers` uses. Both axes share one key space, so a blocker
// listed on both automation and production is ONE decision, made once, reflected in both lists.
//
// DIRECTION 8 — THE KEY IS THE CAUSE, NOT THE SENTENCE. The key used to hash the blocker's text, on
// the premise that a blocker is prose with no id. Passport 0.4.0 mints `findings[].id` per cause, and
// one blocker's sentence LISTS the repo's missing scripts — so adding a `lint` script reworded it,
// rotated the key, and orphaned the decision the owner had recorded. `blockerKeys` returns the id key
// first (what a new decision is written under) and the old prose key second (read-only, so a decision
// made before this change still suppresses its blocker). See findings.ts for the cleanup window.
//
// ONE JUDGMENT MODEL (card ai-native-passports#A). The key AND the state now come from `judgeFinding`
// (src/lib/org/passport-judgments.ts) — the same model the rail badge and the fleet Pareto read — with
// its fixed precedence: overlay reconfirm > overlay decline > OrgDecision > open. The row used to look
// only at OrgDecisions, so a member's "Dismissed" under the same id key buried an owner decline the
// overlay had RE-SURFACED for re-confirmation behind a greyed pill.
export function BlockerList({
  title,
  items,
  allClear,
  org,
  fullName,
  decisions,
  findings,
  declined,
}: {
  title: string;
  items: string[];
  allClear: string;
  org: string;
  fullName: string;
  decisions: DecisionMap;
  /** 0.4.0's minted findings for THIS axis, same sentences. Absent on a pre-0.4.0 stored passport,
   *  which keeps the legacy text key — there is no id to key on, and inventing one would orphan the
   *  very decisions this change exists to preserve. */
  findings?: PassportFinding[];
  /** The owner's declines for this repo (`passport.declined`), so a re-surfaced one outranks a
   *  member's decision on the same finding. */
  declined?: DeclinedByChoice[];
}) {
  return (
    <div>
      <div className="type-label tracking-widest text-slate-500">{title}</div>
      {items.length === 0 ? (
        <p className="mt-1.5 type-body-sm text-emerald-400/80">{allClear}</p>
      ) : (
        <ul className="mt-1.5 space-y-2.5">
          {items.map((b) => {
            const finding = findings?.find((f) => f.text === b);
            // Reads the id key, then any legacy prose alias; `j.key` is always the WRITE key. Null for a
            // coverage hole, which is never a decidable finding.
            const j = judgeFinding({ fullName, finding: { id: finding?.id, code: finding?.code, text: b }, declined, decisions });
            // Pre-0.4.0 rows have no minted id to classify, so the control stays on the prose key.
            const offerDecision = j !== null && (findings === undefined || isDeclinableFinding(finding?.id));
            const status = j?.source === "decision" ? (j.state as DecisionStatusUi) : "open";
            return (
              <li key={b} className={`type-body-sm text-slate-300 ${j && !j.open ? "opacity-60" : ""}`}>
                <span className="flex gap-2">
                  <span aria-hidden className="mt-0.5 shrink-0 text-orange-400">▸</span>
                  {b}
                </span>
                {offerDecision && (
                  <div className="ml-4 mt-1.5">
                    <DecisionControl
                      org={org}
                      module="passports"
                      itemKey={j.key}
                      title={b}
                      status={status}
                      rationale={j.source === "decision" ? (j.reason ?? "") : undefined}
                      decidedBy={j.source === "decision" ? j.by : undefined}
                    />
                  </div>
                )}
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
                {/* WHO decided, not just when. A decline is a decision record; one with no author is an
                    assertion nobody owns, and the actor used to live only in the audit row. An absent
                    author (a decline recorded before authorship was captured) reads as unknown. */}
                <span className="type-caption text-slate-600"> · declined by {d.by ?? "unknown"}{d.at ? ` on ${d.at}` : ""}</span>
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
