// WHAT A HOLDER MAY WRITE AFTER THE CLAIM, and the claimed row as it crosses the wire.
//
// Split out of `followup-claims.ts`, which re-exports everything here, so callers and the
// `vi.mock("@/lib/db/followup-claims")` seams keep working. The claim itself (the compare-and-set,
// the sweep, the release) stays there; this file holds the row shape both halves return and the two
// reads/writes a holder makes afterwards: `reportAttempt` and `heldFollowups`.
//
// EVERY POST-CLAIM WRITE IS FENCED TO THE CLAIM GENERATION THAT AUTHORIZED IT. The holder clause says
// WHO; the fence says WHICH of that holder's claims. Without it a token whose lease lapsed, was swept
// and was claimed again by its own second session could report on the new claim from the old one.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans-audit";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { AttemptVerdict, ClaimExecutor } from "@/lib/org/followups";
import { fenceOf, fenceVerdict } from "@/lib/org/followups-claims";

/**
 * One claimed row as it crosses to a client. WIRE-SAFE: `leaseUntil` is an ISO string, mapped with
 * `.toISOString()` here; a `Date` would type-check in the ledger and throw at `getTime()`.
 */
export interface FollowupClaimRow {
  id: string;
  repo: string;
  title: string;
  claimActor: string | null;
  claimExecutor: ClaimExecutor | null;
  leaseUntil: string | null;
  needsHuman: boolean;
  /** The claim generation a later write must present: the lease ISO, null for an unleased claim. */
  fence: string | null;
}

export interface ClaimedRowShape {
  id: string;
  title: string;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
  scan: { repo: { fullName: string } };
}

const asExecutor = (v: string | null): ClaimExecutor | null =>
  v === "local" || v === "remote-agent" || v === "human" ? v : null;

export function toClaimRow(r: ClaimedRowShape): FollowupClaimRow {
  const leaseUntil = r.leaseUntil ? r.leaseUntil.toISOString() : null;
  return {
    id: r.id,
    repo: r.scan.repo.fullName,
    title: r.title,
    claimActor: r.claimActor,
    claimExecutor: asExecutor(r.claimExecutor),
    leaseUntil,
    needsHuman: r.needsHuman,
    fence: fenceOf(leaseUntil),
  };
}

export const CLAIM_SELECT = {
  id: true,
  title: true,
  claimActor: true,
  claimExecutor: true,
  leaseUntil: true,
  needsHuman: true,
  scan: { select: { repo: { select: { fullName: true } } } },
} satisfies Prisma.RecommendationSelect;

/**
 * THE HOLDER CLAUSE: the set of `claimActor` values that count as "this caller".
 *
 * Normally one value. It still takes a second, TRANSITIONAL one: the MCP door changed the identity it
 * stores from `agent:<token name>` to `agent:<token id>` on 2026-09-05, and names are not unique, so
 * the old form made two live tokens named `ci` one holder. The legacy arm keeps rows stored in the old
 * form workable by the token that claimed them.
 *
 * WHY IT IS STILL HERE (2026-10-22). Every LEASED row in the old form lapsed long ago; what remains is
 * an unleased in-progress row an old session reported `resolved` or `needs_human` on, and the door
 * still hands `legacyActor` to external callers. Removing it would break an external client that
 * briefs or re-reports such a row, so it stays until the door stops populating it. The fence below
 * narrows its reach: a leased row cannot be reported on from a superseded generation whatever the name.
 */
function holderActors(actor: string, legacyActor?: string | null): string[] {
  return legacyActor && legacyActor !== actor ? [actor, legacyActor] : [actor];
}

export interface ReportAttemptInput {
  org: string;
  id: string;
  actor: string;
  /** TRANSITIONAL second holder form accepted alongside `actor`; see `holderActors`. */
  legacyActor?: string | null;
  /** The fence `claimFollowups` returned for this row. Optional for backward compatibility: an
   *  unfenced report from the holder is accepted and logged as deprecated; a STALE one is refused. */
  fence?: string | null;
  verdict: AttemptVerdict;
  reason: string;
  branch?: string | null;
  prUrl?: string | null;
  tokenId?: string | null;
}

/** A report whose fence named a claim generation the row no longer holds. Nothing was written. */
export interface StaleClaimRefusal {
  refused: "stale-claim";
  /** The live claim's lease, so the refusal can name it; null when the live claim is unleased. */
  leaseUntil: string | null;
}

export const isStaleClaim = (v: FollowupClaimRow | StaleClaimRefusal | null): v is StaleClaimRefusal =>
  v != null && "refused" in v && v.refused === "stale-claim";

/** Actors already told their unfenced report is deprecated. Once per actor per process is enough. */
const warnedUnfenced = new Set<string>();

function warnUnfencedOnce(actor: string): void {
  if (warnedUnfenced.has(actor)) return;
  warnedUnfenced.add(actor);
  console.warn(
    `[followups] DEPRECATED: ${actor} reported an attempt on a leased row without a fence. It was accepted; send the fence claim_followups returned so a superseded session cannot write into a newer claim.`,
  );
}

/**
 * Record what a worker says it did with ONE row it holds. Returns the row's state afterwards, a
 * `StaleClaimRefusal` when the presented fence is not the live claim generation, or `null` when the id
 * is not this org's, is not held by this actor, or persistence is off.
 *
 * THE VERDICT TABLE, and every line of it is the same rule stated three ways: nothing here closes.
 *   - `resolved`: the row STAYS `in_progress`, the lease is cleared. The rescan owns it now.
 *   - `skipped`: back to `open`, lease and claim columns cleared, for whoever comes next.
 *   - `needs_human`: stays `in_progress` with `needsHuman = true` and no lease. An escalation, not a
 *     status: the work is visibly still open rather than quietly closed by a machine that gave up.
 */
export async function reportAttempt(input: ReportAttemptInput): Promise<FollowupClaimRow | StaleClaimRefusal | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(input.org);
  if (!org) return null;
  const prisma = getPrisma();

  const actors = holderActors(input.actor, input.legacyActor);
  const held = await prisma.recommendation.findFirst({
    where: { id: input.id, claimActor: { in: actors }, status: "in_progress", scan: { repo: { orgId: org.id } } },
    select: { id: true, leaseUntil: true },
  });
  if (!held) return null;

  const stored = held.leaseUntil ? held.leaseUntil.toISOString() : null;
  const fence = fenceVerdict(stored, input.fence);
  if (fence === "stale") return { refused: "stale-claim", leaseUntil: stored };
  if (fence === "unfenced") warnUnfencedOnce(input.actor);

  const data =
    input.verdict === "skipped"
      ? { status: "open", claimActor: null, claimExecutor: null, leaseUntil: null }
      : input.verdict === "needs_human"
        ? { leaseUntil: null, needsHuman: true }
        : { leaseUntil: null };

  const note = [
    input.reason.trim().slice(0, 600) || "(no reason given)",
    input.branch ? `branch ${input.branch}` : null,
    input.prUrl ? input.prUrl : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const updated = await prisma.$transaction(async (tx) => {
    // Guarded on the holder AND the generation inside the transaction: the read above and this write
    // must not straddle a sweep and re-claim, which would leave the holder the same and the claim new.
    const res = await tx.recommendation.updateMany({
      where: { id: input.id, status: "in_progress", claimActor: { in: actors }, leaseUntil: held.leaseUntil },
      data,
    });
    if (res.count !== 1) return null;
    await tx.recommendationEvent.create({
      data: {
        recommendationId: input.id,
        actor: input.actor,
        // `attempt` is the row's own vocabulary for "the worker's account", distinct from `status`.
        kind: "attempt",
        fromValue: null,
        toValue: input.verdict,
        note,
      },
    });
    return tx.recommendation.findUnique({ where: { id: input.id }, select: CLAIM_SELECT });
  });
  if (!updated) return null;

  await recordAudit(
    "followup.attempt",
    {
      id: input.id,
      actor: input.actor,
      verdict: input.verdict,
      tokenId: input.tokenId ?? null,
      branch: input.branch ?? null,
      prUrl: input.prUrl ?? null,
    },
    { orgId: org.id },
  ).catch(() => false);

  return toClaimRow(updated as ClaimedRowShape);
}

/**
 * The rows `actor` currently holds, of the ids given. `get_fix_brief`'s authorization boundary: a row
 * claimed by somebody else is refused BY ID rather than silently dropped. Each row carries its fence.
 */
export async function heldFollowups(
  orgSlug: string,
  ids: readonly string[],
  actor: string,
  legacyActor?: string | null,
): Promise<FollowupClaimRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().recommendation.findMany({
    where: {
      id: { in: [...new Set(ids)] },
      claimActor: { in: holderActors(actor, legacyActor) },
      status: "in_progress",
      scan: { repo: { orgId: org.id } },
    },
    select: CLAIM_SELECT,
  });
  return rows.map((r) => toClaimRow(r as ClaimedRowShape));
}
