"use client";

// WHAT SHE OFFERED, answerable where she made it.
//
// A proposal is the seam between "she said something" and "something happened": nothing she suggests
// takes effect until a person answers it, and the only answer is a request to the one door
// (`POST /api/athena/proposals/[id]/resolve`), which re-validates, gates on role and audits. This card
// states the ask, offers Accept / Decline while the row is open, and paints what came of it after.
//
// What the card may show is decided in `proposalModel.ts` (pure): the buttons are read off the shared
// lifecycle table, an identity_diff is decline-only (the door refuses its accept), a 409 never brings a
// button back, and a 500 that says the action ran is held rather than offered for a retry.
//
// THE SENTENCE IS THE SERVER'S. An action payload carries `{ params }` only, and the summary is resolved
// from the action spec by the boot route, the same `athenaActionSummary` the cron briefing uses. The
// payload reader below is the fallback for kinds that carry their ask in the payload (an identity diff).

import { Kicker } from "@/components/ui";
import type { AthenaProposalWire } from "./model";
import { announcementFor, cardStateOf, IDENTITY_DIFF, type AthenaDecision, type LocalCard, type OutcomeTone } from "./proposalModel";

/** A human title for a proposal kind: `identity_diff` is the one named kind; the rest are action ids. */
export function proposalTitle(kind: string): string {
  if (kind === IDENTITY_DIFF) return "A change to what she believes about this org";
  return kind.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The ask, in one line, from whichever field this kind's payload put it in. */
export function proposalSummary(payload: Record<string, unknown>): string | null {
  for (const key of ["summary", "reason", "title", "description", "line"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const ops = payload.ops;
  if (Array.isArray(ops) && ops.length > 0) {
    return `${ops.length} edit${ops.length === 1 ? "" : "s"} to her self-model.`;
  }
  return null;
}

const KICKER: Record<string, string> = {
  ask: "Awaiting a decision",
  submitting: "Sending your answer",
  answered: "Answered",
  answered_elsewhere: "Answered elsewhere",
  held: "Not run again",
  expired: "Expired",
  unknown: "Not actionable",
};

const TONE: Record<OutcomeTone, string> = {
  done: "border-l-2 border-accent/60 text-slate-200",
  refusal: "border-l-2 border-amber-500/40 text-slate-300",
  neutral: "border-l-2 border-slate-600 text-slate-400",
};

const BUTTON =
  "focus-ring rounded-lg border px-3 py-1.5 type-body-sm transition disabled:cursor-not-allowed disabled:opacity-50";

export function AthenaProposalCard({
  proposal,
  local,
  onDecide,
}: {
  proposal: AthenaProposalWire;
  /** This tab's last answer to this offer, if any. */
  local?: LocalCard;
  onDecide?: (decision: AthenaDecision) => void;
}) {
  const summary = proposal.summary || proposalSummary(proposal.payload);
  const state = cardStateOf(proposal, local);
  const live = state.mode === "ask" || state.mode === "submitting";
  const busy = state.mode === "submitting";
  const settledHere = local?.phase === "settled" ? local.result : null;

  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 ${live ? "border-accent/40 bg-accent/[0.06]" : "border-slate-700 bg-slate-900/40"}`}
      aria-busy={busy || undefined}
    >
      <Kicker tone={live ? "accent" : "muted"}>{KICKER[state.mode]}</Kicker>
      <p className="mt-1 type-body-sm font-semibold text-white">{proposalTitle(proposal.kind)}</p>
      {summary && <p className="mt-1 type-note leading-relaxed text-slate-300">{summary}</p>}

      {state.outcome && <p className={`mt-2 pl-2 type-note leading-relaxed ${TONE[state.outcome.tone]}`}>{state.outcome.detail}</p>}
      {state.note && <p className="mt-2 type-note leading-relaxed text-slate-400">{state.note}</p>}
      {state.error && <p role="alert" className="mt-2 border-l-2 border-danger/60 pl-2 type-note leading-relaxed text-slate-300">{state.error}</p>}

      {onDecide && live && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {proposal.kind !== IDENTITY_DIFF && (
            <button
              type="button"
              disabled={!state.canAccept}
              onClick={() => onDecide("accept")}
              className={`${BUTTON} border-accent/60 text-white hover:border-accent hover:bg-accent/10`}
            >
              Accept
            </button>
          )}
          <button
            type="button"
            disabled={!state.canDecline}
            onClick={() => onDecide("decline")}
            className={`${BUTTON} border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white`}
          >
            Decline
          </button>
          {proposal.kind === IDENTITY_DIFF && (
            <span className="type-note text-slate-500">A change to her self-model cannot be accepted from here yet.</span>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {settledHere ? announcementFor(settledHere) : ""}
      </p>
    </div>
  );
}
