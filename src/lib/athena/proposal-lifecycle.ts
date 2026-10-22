// THE PROPOSAL GATE AS A WRITTEN STATE MACHINE. Pure: no Prisma, no clock of its own (every reader
// passes `nowMs`), so the store, the resolve route, the sweep and the client card all read one table.
//
// The stored `status` column carries four values (open | accepted | declined | expired). The LIFECYCLE
// is derived from it plus `resolvedAt` / `claimedAt`, and it names the two states the columns only
// implied before: a CLAIM (accepted, unstamped, recent) and a STALE claim (accepted, unstamped, and
// older than any request that could still be running). Anything else the column holds is `unknown`,
// and `unknown` is not actionable - a corrupt or future status must never read as an open Accept.
//
// EVERY HOLD NAMES ITS REAPER. A claim ends at its stamp, its release (the executor threw in the same
// request) or - when the request died - at the sweep, which stamps it `interrupted`. It is NEVER
// released back to open by the sweep: the executor's outcome is unknown, and an action like
// record_memory is not idempotent, so a retry could write twice. An open ask ends at a human answer or
// at the TTL, and expiry is a WRITE with a recorded reason (status `expired`), never a read-side filter.

/** An open ask nobody answers inside this many days is written `expired` by the sweep. */
export const ATHENA_PROPOSAL_TTL_DAYS = 14;
/**
 * A claim older than this is stale: its request is past any function cap (the resolve route runs
 * well inside the platform's 300 s ceiling), so nothing is coming back to stamp it.
 */
export const ATHENA_CLAIM_STALE_MS = 10 * 60_000;

const DAY_MS = 86_400_000;

/** What the `status` column may hold. A value outside this list reads as `unknown`. */
export const ATHENA_STORED_STATUSES = ["open", "accepted", "declined", "expired"] as const;
export type AthenaStoredStatus = (typeof ATHENA_STORED_STATUSES)[number];

export const ATHENA_PROPOSAL_LIFECYCLES = [
  "open",
  "claimed",
  "claimed_stale",
  "accepted",
  "declined",
  "expired",
  "unknown",
] as const;
export type AthenaProposalLifecycle = (typeof ATHENA_PROPOSAL_LIFECYCLES)[number];

/** Outcome kinds the sweep stamps. They sit beside the action outcomes in `payload.outcome.kind`. */
export const OUTCOME_INTERRUPTED = "interrupted";
export const OUTCOME_EXPIRED = "expired";

export const isStoredStatus = (s: string): s is AthenaStoredStatus =>
  (ATHENA_STORED_STATUSES as readonly string[]).includes(s);

type Stamp = string | Date | null | undefined;
const msOf = (t: Stamp): number | null => {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
};

export interface LifecycleInput {
  status: string;
  resolvedAt?: Stamp;
  claimedAt?: Stamp;
  createdAt?: Stamp;
}

/** The one derivation. `nowMs` only matters for telling a live claim from a stale one. */
export function lifecycleOf(row: LifecycleInput, nowMs: number = Date.now()): AthenaProposalLifecycle {
  switch (row.status) {
    case "open":
      return "open";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "accepted": {
      if (row.resolvedAt != null) return "accepted";
      // A claim taken before claimedAt existed has an unknowable age: it is treated as stale, which
      // resolves it to a refusal (interrupted), never to a retry.
      const claimed = msOf(row.claimedAt);
      if (claimed === null) return "claimed_stale";
      return nowMs - claimed > ATHENA_CLAIM_STALE_MS ? "claimed_stale" : "claimed";
    }
    default:
      return "unknown";
  }
}

/** True when an open ask raised at `createdAt` has outlived the TTL at `nowMs`. */
export function askHasExpired(createdAt: Stamp, nowMs: number = Date.now()): boolean {
  const created = msOf(createdAt);
  return created !== null && nowMs - created > ATHENA_PROPOSAL_TTL_DAYS * DAY_MS;
}

export type AthenaProposalEvent = "accept" | "decline" | "stamp" | "release" | "expire" | "interrupt";
/** Who may drive an edge: a person at the door, the request that holds the claim, or the reaper. */
export type AthenaEdgeDriver = "human" | "resolver" | "sweep";

interface Edge {
  next: AthenaProposalLifecycle;
  by: AthenaEdgeDriver;
}

/**
 * Every legal edge. An edge absent from this table is a CONFLICT. Note what is missing on purpose:
 * nothing leaves accepted / declined / expired / unknown, a claim cannot be declined, and a stale
 * claim cannot be released (only stamped late by its own request, or interrupted by the sweep).
 */
const EDGES: Partial<Record<AthenaProposalLifecycle, Partial<Record<AthenaProposalEvent, Edge>>>> = {
  open: {
    accept: { next: "claimed", by: "human" },
    decline: { next: "declined", by: "human" },
    expire: { next: "expired", by: "sweep" },
  },
  claimed: {
    stamp: { next: "accepted", by: "resolver" },
    release: { next: "open", by: "resolver" },
  },
  claimed_stale: {
    stamp: { next: "accepted", by: "resolver" },
    interrupt: { next: "accepted", by: "sweep" },
  },
};

export type AthenaTransition =
  | { ok: true; next: AthenaProposalLifecycle; by: AthenaEdgeDriver }
  | { ok: false; conflict: true; current: AthenaProposalLifecycle };

export function transition(current: AthenaProposalLifecycle, event: AthenaProposalEvent): AthenaTransition {
  const edge = EDGES[current]?.[event];
  return edge ? { ok: true, next: edge.next, by: edge.by } : { ok: false, conflict: true, current };
}

export const canAccept = (s: AthenaProposalLifecycle): boolean => transition(s, "accept").ok;
export const canDecline = (s: AthenaProposalLifecycle): boolean => transition(s, "decline").ok;
