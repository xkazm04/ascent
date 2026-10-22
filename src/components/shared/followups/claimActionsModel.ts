// THE HUMAN CLAIM VERBS - pure. Which of take over / send back / release a viewer may apply to one
// ledger row, and which picked rows a fix prompt may name.
//
// A claim state the ledger renders needs the action that resolves it. Before this file the needs-human
// chip described itself as the one state "only a person can clear" and no surface could clear it; a
// person who handed off a batch and never pasted it could not give it back. The same table reads
// identically here, in the expanded row, on the batch bar and at POST /api/org/followups/claims, so
// the button a viewer sees is the request the route will accept.
//
//   take-over  any member, on a needs-human row only: "I'll take this". The row stays in progress,
//              now held by the viewer as an unleased human claim, and the flag clears.
//   send-back  a needs-human row (any member), or any claim at all for an admin: "put it back for the
//              next worker". The row returns to open with every claim column cleared.
//   release    the viewer's OWN human claim, or any human claim for an admin: "I am not doing this
//              after all". Same effect as send back, named for the holder.
//
// The write side (src/lib/db/followup-claims-human.ts) is a compare-and-set on the claim generation it
// read, so a verb computed here against a stale row is refused there as `not-held`, never applied.
//
// Pure apart from `postClaimVerb`, the one fetch the row and the bar share; no server import, so the
// client components may import it.

import type { FollowUpRow } from "./followupsModel";

export type ClaimVerb = "take-over" | "send-back" | "release";
export const CLAIM_VERBS: readonly ClaimVerb[] = ["take-over", "send-back", "release"];
export const isClaimVerb = (v: unknown): v is ClaimVerb => typeof v === "string" && (CLAIM_VERBS as readonly string[]).includes(v);

/** The viewer the verbs are computed for. `admin` is the org role, resolved server-side. */
export interface ClaimViewer {
  login: string;
  admin: boolean;
}

/** The holder name a viewer with no resolvable login (a dev auth bypass) gets. The hand-off route
 *  stores the same words, so such a viewer can still release what it handed off. */
export const VIEWER_FALLBACK = "browser hand-off";

/** At most this many rows per claim-verb request, the hand-off's own cap. */
export const MAX_CLAIM_BATCH = 50;

export type ClaimState = Pick<FollowUpRow, "status" | "claimActor" | "claimExecutor" | "leaseUntil" | "needsHuman">;

const liveLease = (leaseUntil: string | null | undefined, now: Date): boolean => {
  if (!leaseUntil) return false;
  const t = Date.parse(leaseUntil);
  return Number.isFinite(t) && t > now.getTime();
};

/** An unleased human claim: the browser hand-off's shape, which no sweep reclaims. */
const humanClaim = (r: ClaimState): boolean => r.claimExecutor === "human" && !r.leaseUntil;

/** The verbs `viewer` may apply to `row`, in display order. `[]` for every row nobody holds. */
export function claimActionsFor(row: ClaimState, viewer: ClaimViewer, now: Date = new Date()): ClaimVerb[] {
  void now; // the table does not depend on the clock today; the parameter keeps call sites stable
  if (row.status !== "in_progress") return [];
  if (row.needsHuman) return ["take-over", "send-back"];
  if (humanClaim(row)) return row.claimActor === viewer.login || viewer.admin ? ["release"] : [];
  return viewer.admin ? ["send-back"] : [];
}

/** True when `verb` on `row` is allowed only because the viewer is an admin. The route escalates to
 *  the admin gate exactly when this is true for some row of the batch. */
export function verbNeedsAdmin(row: ClaimState, verb: ClaimVerb, login: string, now: Date = new Date()): boolean {
  return !claimActionsFor(row, { login, admin: false }, now).includes(verb) && claimActionsFor(row, { login, admin: true }, now).includes(verb);
}

export interface HeldElsewhere {
  id: string;
  holder: string;
  /** The live lease's expiry ISO; null for another person's unleased claim. */
  until: string | null;
}

/**
 * Which picked rows a fix prompt may name. A row somebody else is working is LEFT OUT: a live lease
 * held by another worker, or another person's unleased hand-off. A prompt naming work somebody else
 * holds is a prompt asking for a merge conflict, which the loop lane already refuses. Kept: open rows,
 * the viewer's own claims, a needs-human row (its holder stopped), a lapsed lease, and a legacy
 * in-progress row with no recorded holder.
 */
export function promptPartition<R extends ClaimState & { id: string }>(
  rows: readonly R[],
  viewer: Pick<ClaimViewer, "login">,
  now: Date = new Date(),
): { include: R[]; held: HeldElsewhere[] } {
  const include: R[] = [];
  const held: HeldElsewhere[] = [];
  for (const r of rows) {
    const holder = r.claimActor ?? null;
    const elsewhere =
      r.status === "in_progress" && holder !== null && holder !== viewer.login && !r.needsHuman && (liveLease(r.leaseUntil, now) || humanClaim(r));
    if (elsewhere) held.push({ id: r.id, holder, until: r.leaseUntil ?? null });
    else include.push(r);
  }
  return { include, held };
}

/** The modal's whole plan: what the prompt names, what is left out, and what "Hand off" marks. */
export function promptPlan<R extends ClaimState & { id: string }>(rows: readonly R[], viewer: Pick<ClaimViewer, "login">, now: Date = new Date()) {
  const { include, held } = promptPartition(rows, viewer, now);
  return { include, held, toMark: include.filter((r) => r.status === "open").map((r) => r.id) };
}

/** POST one claim verb over a batch. Throws the route's own sentence on a refusal. */
export async function postClaimVerb(org: string, action: ClaimVerb, ids: readonly string[]): Promise<void> {
  const r = await fetch("/api/org/followups/claims", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org, action, ids }),
  });
  if (r.ok) return;
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  throw new Error(d.error ?? `Failed (${r.status}).`);
}
