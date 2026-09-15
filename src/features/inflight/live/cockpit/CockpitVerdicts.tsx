"use client";

// PER-ITEM VERDICTS — what the lane's agent says happened to each row it was handed, beside what the
// rescan ruled.
//
// The two are deliberately not merged into one word. Every verdict except a VERIFIED `resolved` is
// the agent's own account, and the panel shows the account as an account. A `needs_human` is the only
// chip that carries a warning tone, because it is the only one that is asking for something.
//
// `resolved` IS TWO DIFFERENT STATEMENTS AND THIS PANEL USED TO PRINT ONE (UAT `PRIYA-L1-702`).
// The header here asserted "`resolved` always means the RESCAN closed it" and the label said "closed
// by the rescan" — for every row, unconditionally, including a `resolved` the AGENT claimed and
// nothing confirmed. It was worse than a wording slip: the lane fed `recordLaneOutcomes` the commit
// TRAILER set, which the lane itself had written from the session's own `RESOLVED:` lines, so the
// two sets were identical by construction. 46 rows read "closed by the rescan" while the ledger that
// applies the real gate reported `done: 0`.
//
// So the row now carries `verified` — true only when `decideInProgress` ruled the id closed — and
// this panel renders the two as different things: a verified close in the accent tone with the
// mechanism named, an unverified claim in a muted, italic tone reading "claimed resolved — awaiting
// the rescan". A row from a payload with no `verified` field at all is treated as UNVERIFIED: the
// safe direction for a trust flag is to under-claim.
//
// A DEFERRAL IS SHOWN AS WHAT IT IS: the loop will not re-offer this item for a while. Nothing on the
// backlog row changed — every other surface still shows it open — and saying so here is what stops a
// reader concluding the loop closed their item.

import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import type { LaneOutcomeRow } from "./loopTypes";

/** Tone per verdict. Only `needs_human` is a warning: it is the only one asking for a person. */
const TONE: Record<string, string> = {
  resolved: "text-accent",
  skipped: "text-slate-400",
  needs_human: "text-warn",
  attempted: "text-slate-500",
  absent: "text-slate-600",
};

const LABEL: Record<string, string> = {
  resolved: "closed by the rescan",
  skipped: "skipped",
  needs_human: "needs a human",
  attempted: "attempted",
  absent: "no account given",
};

/** The unverified `resolved`: the agent's claim, worded as a claim and toned as one. Italic and
 *  muted so it does not read as a sibling of the accent-toned verified close. */
const CLAIMED_LABEL = "claimed resolved — awaiting the rescan";
const CLAIMED_TONE = "italic text-slate-400";
const CLAIMED_TITLE =
  "The agent reported this resolved. The rescan has not confirmed it — the gap is still raised, or its dimension did not measurably move. The item is still open.";
const VERIFIED_TITLE = "The rescan closed this: the gap is no longer raised and its dimension measurably moved.";

/** What the chip says, and how it is toned. The one place the claim/verdict split is decided. */
export function verdictChip(o: { verdict: string; verified?: boolean }): { label: string; tone: string; title: string } {
  if (o.verdict === "resolved" && !o.verified) return { label: CLAIMED_LABEL, tone: CLAIMED_TONE, title: CLAIMED_TITLE };
  return {
    label: LABEL[o.verdict] ?? o.verdict,
    tone: TONE[o.verdict] ?? "text-slate-500",
    title: o.verdict === "resolved" ? VERIFIED_TITLE : "",
  };
}

export interface CockpitVerdictsProps {
  /** Defaulted, because a payload from a server older than this field is `undefined` rather than
   *  `[]` — and a cockpit that crashes on a stale poll is worse than one that says "none recorded". */
  outcomes?: LaneOutcomeRow[];
}

export function CockpitVerdicts({ outcomes = [] }: CockpitVerdictsProps) {
  return (
    <section aria-label="Per-item verdicts" className="mt-4">
      <Kicker tone="muted">Item verdicts</Kicker>
      {outcomes.length === 0 ? (
        <InlineEmpty>This run recorded no per-item verdicts.</InlineEmpty>
      ) : (
        <ul className={`mt-2 ${TILE_LEDGER}`}>
          {outcomes.map((o) => {
            const chip = verdictChip(o);
            return (
            <li key={o.id} className="bg-ink px-4 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 truncate type-caption text-slate-400" title={o.recommendationId}>
                  {o.repoFullName} · {o.recommendationId.slice(0, 8)}
                </span>
                <span className={`shrink-0 type-caption ${chip.tone}`} title={chip.title || undefined}>
                  {chip.label}
                </span>
              </div>
              {o.reason && <p className="mt-1 type-caption leading-relaxed text-slate-400">{o.reason}</p>}
              <p className="mt-1 type-caption text-slate-600">
                cycle {o.cycle} · {timeAgo(o.createdAt)}
                {o.deferUntil && (
                  <span
                    className="ml-2"
                    title="The loop will not re-offer this item until then. Nothing on the backlog row changed — it is still open everywhere else."
                  >
                    · not re-offered until {o.deferUntil.slice(0, 10)}
                  </span>
                )}
                {o.files.length > 0 && <span className="ml-2">· {o.files.length} file(s) claimed</span>}
              </p>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
