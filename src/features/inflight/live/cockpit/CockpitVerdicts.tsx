"use client";

// PER-ITEM VERDICTS — what the lane's agent says happened to each row it was handed, beside what the
// rescan ruled.
//
// The two are deliberately not merged into one word. `resolved` here always means the RESCAN closed
// it; every other verdict is the agent's own account, and the panel shows the account as an account.
// A `needs_human` is the only chip that carries a warning tone, because it is the only one that is
// asking for something.
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
          {outcomes.map((o) => (
            <li key={o.id} className="bg-ink px-4 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 truncate font-mono text-xs text-slate-400" title={o.recommendationId}>
                  {o.repoFullName} · {o.recommendationId.slice(0, 8)}
                </span>
                <span className={`shrink-0 font-mono text-xs ${TONE[o.verdict] ?? "text-slate-500"}`}>
                  {LABEL[o.verdict] ?? o.verdict}
                </span>
              </div>
              {o.reason && <p className="mt-1 text-xs leading-relaxed text-slate-400">{o.reason}</p>}
              <p className="mt-1 font-mono text-xs text-slate-600">
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
          ))}
        </ul>
      )}
    </section>
  );
}
