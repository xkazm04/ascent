// WHAT THE CARD MAY SHOW, as a pure function of the record and the last answer the door gave.
//
// Two inputs, one output. The RECORD (from the boot payload) says what the row is; the LOCAL answer
// (from this tab's own click) says what just happened. The buttons are read off the shared lifecycle
// table (`@/lib/athena/proposal-lifecycle`, pure and client-safe), never off a second list.
//
// The resolve route's contract (docs/features/companion/README.md, "What the resolve route answers"):
//   200 -> paint the outcome; the row is closed.
//   409 -> answered elsewhere; refetch, paint the named state, never offer the button again.
//   500 "action failed" -> the claim was released; the click may be retried.
//   500 "ran, but ... not recorded" -> NEVER retry: the side effect happened. The card is held.
// The two 500s differ only in their sentence, so the second is matched on the route's wording and that
// wording is pinned verbatim in proposalModel.test.ts.
//
// Pure and React-free.

import {
  ATHENA_PROPOSAL_LIFECYCLES,
  canAccept as lifecycleCanAccept,
  canDecline as lifecycleCanDecline,
  lifecycleOf,
  type AthenaProposalLifecycle,
} from "@/lib/athena/proposal-lifecycle";

const isLifecycle = (s: string): s is AthenaProposalLifecycle =>
  (ATHENA_PROPOSAL_LIFECYCLES as readonly string[]).includes(s);

/**
 * The one named kind, as a LITERAL. `IDENTITY_DIFF_KIND` lives in `@/lib/db/athena-proposals`, which
 * imports Prisma at module scope, so a client value import of it fails `next build`. voice.test.ts
 * runs under node and pins this literal to the real constant.
 */
export const IDENTITY_DIFF = "identity_diff";

export type AthenaDecision = "accept" | "decline";

export interface AthenaOutcomeWire {
  ok: boolean;
  kind: string;
  detail: string;
}

export type ResolveResult =
  | { kind: "resolved"; status: "accepted" | "declined"; outcome: AthenaOutcomeWire }
  | { kind: "conflict"; state: AthenaProposalLifecycle | null; error: string }
  | { kind: "retryable"; error: string }
  | { kind: "ran_unrecorded"; error: string }
  | { kind: "refused"; httpStatus: number; error: string }
  | { kind: "unreachable"; error: string };

export type LocalCard = { phase: "submitting"; decision: AthenaDecision } | { phase: "settled"; result: ResolveResult };

export type CardMode = "ask" | "submitting" | "answered" | "answered_elsewhere" | "held" | "expired" | "unknown";
export type OutcomeTone = "done" | "refusal" | "neutral";

export interface CardState {
  mode: CardMode;
  canAccept: boolean;
  canDecline: boolean;
  lifecycle: AthenaProposalLifecycle;
  outcome: { detail: string; tone: OutcomeTone } | null;
  /** A plain sentence about the state, when the state needs one. */
  note: string | null;
  /** The door's own error, beside the card. */
  error: string | null;
}

export interface CardInput {
  status: string;
  kind: string;
  payload?: Record<string, unknown>;
  resolvedAt?: string | null;
  claimedAt?: string | null;
  createdAt?: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const RAN_UNRECORDED = /outcome was not recorded/i;

/** One HTTP answer from the door -> what it means for the card. */
export function parseResolveResponse(httpStatus: number, body: unknown): ResolveResult {
  const b = isRecord(body) ? body : {};
  const error = typeof b.error === "string" && b.error ? b.error : `The request failed (${httpStatus}).`;
  if (httpStatus === 200) {
    const o = isRecord(b.outcome) ? b.outcome : {};
    const status = b.status === "declined" ? "declined" : "accepted";
    return {
      kind: "resolved",
      status,
      outcome: {
        ok: o.ok === true,
        kind: typeof o.kind === "string" ? o.kind : status,
        detail: typeof o.detail === "string" && o.detail ? o.detail : status === "declined" ? "Declined." : "Accepted.",
      },
    };
  }
  if (httpStatus === 409) {
    return { kind: "conflict", state: typeof b.status === "string" && isLifecycle(b.status) ? b.status : null, error };
  }
  if (httpStatus >= 500) return RAN_UNRECORDED.test(error) ? { kind: "ran_unrecorded", error } : { kind: "retryable", error };
  return { kind: "refused", httpStatus, error };
}

/** True when the answer means this tab's copy of the list is stale and must be re-read. */
export const needsRefresh = (r: ResolveResult): boolean =>
  r.kind === "conflict" || r.kind === "unreachable" || (r.kind === "refused" && r.httpStatus === 404);

const toneOf = (o: AthenaOutcomeWire): OutcomeTone => (o.kind === "declined" ? "neutral" : o.ok ? "done" : "refusal");

/** The outcome stamped into a resolved row's payload, or null. */
export function outcomeOf(payload: Record<string, unknown> | undefined): AthenaOutcomeWire | null {
  const o = payload?.outcome;
  if (!isRecord(o) || typeof o.detail !== "string" || !o.detail) return null;
  return { ok: o.ok === true, kind: typeof o.kind === "string" ? o.kind : "", detail: o.detail };
}

const ELSEWHERE: Partial<Record<AthenaProposalLifecycle, string>> = {
  claimed: "Answered elsewhere: someone's accept is running on this offer right now.",
  claimed_stale: "Answered elsewhere: it was accepted, but its outcome was never recorded.",
  accepted: "Answered elsewhere: this offer was accepted.",
  declined: "Answered elsewhere: this offer was declined.",
  expired: "Answered elsewhere: this offer expired unanswered.",
  unknown: "Answered elsewhere: it is in a state this build cannot act on.",
};

function fromRecord(p: CardInput, life: AthenaProposalLifecycle): Omit<CardState, "canAccept" | "canDecline" | "error"> {
  const stamped = outcomeOf(p.payload);
  const outcome = stamped ? { detail: stamped.detail, tone: toneOf(stamped) } : null;
  switch (life) {
    case "open":
      return { mode: "ask", lifecycle: life, outcome: null, note: null };
    case "claimed":
      return { mode: "held", lifecycle: life, outcome, note: "An accept is running on this offer right now." };
    case "claimed_stale":
      return { mode: "held", lifecycle: life, outcome, note: "It was accepted, but its outcome was never recorded. It will not be run again." };
    case "accepted":
    case "declined":
      return { mode: "answered", lifecycle: life, outcome: outcome ?? { detail: life === "declined" ? "Declined." : "Accepted.", tone: life === "declined" ? "neutral" : "done" }, note: null };
    case "expired":
      return { mode: "expired", lifecycle: life, outcome, note: outcome ? null : "This offer expired unanswered." };
    default:
      return { mode: "unknown", lifecycle: life, outcome: null, note: "This offer is in a state this build cannot act on." };
  }
}

/** The card, derived. `nowMs` only tells a live claim from a stale one. */
export function cardStateOf(p: CardInput, local?: LocalCard, nowMs: number = Date.now()): CardState {
  const life = lifecycleOf({ status: p.status, resolvedAt: p.resolvedAt, claimedAt: p.claimedAt, createdAt: p.createdAt }, nowMs);
  const closed = { canAccept: false, canDecline: false };
  if (local?.phase === "submitting") return { mode: "submitting", ...closed, lifecycle: life, outcome: null, note: null, error: null };
  const r = local?.phase === "settled" ? local.result : null;
  if (r?.kind === "resolved") {
    return { mode: "answered", ...closed, lifecycle: r.status, outcome: { detail: r.outcome.detail, tone: toneOf(r.outcome) }, note: null, error: null };
  }
  if (r?.kind === "conflict") {
    const state = r.state ?? (life === "open" ? null : life);
    const stamped = outcomeOf(p.payload);
    return {
      mode: "answered_elsewhere",
      ...closed,
      lifecycle: state ?? life,
      outcome: stamped ? { detail: stamped.detail, tone: toneOf(stamped) } : null,
      note: (state && ELSEWHERE[state]) || "Answered elsewhere: this offer is no longer open.",
      error: null,
    };
  }
  if (r?.kind === "ran_unrecorded") return { mode: "held", ...closed, lifecycle: life, outcome: null, note: null, error: r.error };
  const base = fromRecord(p, life);
  const ask = base.mode === "ask";
  return {
    ...base,
    canAccept: ask && p.kind !== IDENTITY_DIFF && lifecycleCanAccept(life),
    canDecline: ask && lifecycleCanDecline(life),
    error: r ? r.error : null,
  };
}

/** The ids a settled turn says it raised (`meta.proposalIds`), read defensively. */
export function proposalIdsOf(turn: { meta?: Record<string, unknown> }): string[] {
  const ids = turn.meta?.proposalIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** One polite sentence when a decision settles, and only then. An error already sits in an alert. */
export function announcementFor(r: ResolveResult): string {
  if (r.kind === "resolved") return r.status === "declined" ? "Declined." : `Accepted. ${r.outcome.detail}`;
  return r.kind === "conflict" ? "That offer was already answered elsewhere." : "";
}
