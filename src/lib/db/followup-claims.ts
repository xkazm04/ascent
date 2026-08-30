// THE ONE CLAIM PATH (moonshot #3) — how any worker takes a follow-up off the ledger, and the only
// way any of them may.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS AT ALL. Before it there were two: the local loop engine claimed a row with an
// unconditional `updateRecommendation(id, {status:"in_progress"})`, and the browser hand-off claimed
// one with a compare-and-set in `handoffRecommendations`. Adding a third caller — a remote agent
// pulling work over MCP — to that arrangement would have made "who holds this row" a question with
// two implementations and no answer. So every claim now runs through `claimFollowups`, and the
// arbitration is a single `updateMany` whose WHERE carries the expected state: `count === 1` won,
// `0` lost. THE DATABASE DECIDES. Not a mutex, not an ordering convention, not a lock the next
// caller might forget to take.
//
// A CLAIM IS A STATE OF THE ROW IT CLAIMS. There is deliberately no `FollowupClaim` side table: a
// second place to ask "who holds this" is precisely the race this module exists to prevent, and it
// would need its own retention rule, its own erase cascade and its own reconciliation with the row.
// The columns live on `Recommendation`, so purge and erase behaviour is unchanged.
//
// WHAT NO PATH HERE CAN DO IS CLOSE A ROW. `status: "done"` is reachable only from `scans-persist`'s
// `decideInProgress` — a rescan of the branch that both stops restating the gap AND measures the
// dimension moving. `report_attempt` writes an event and clears a lease; it is a second claim of the
// same weight as the commit trailer, never a verdict. That is the whole answer to the catalog's own
// question about what stops an agent closing its own recommendation: there is no verb.
//
// LEASES EXPIRE LAZILY. `sweepExpiredLeases` runs at the top of a claim and at the ledger read, the
// same precedent `markStaleRunsStopped` sets on `GET /api/org/loop`. No cron entry is requested — the
// cron surface belongs to W3-L, and a claim path that needs a scheduler to be correct is a claim path
// that is wrong on a deployment whose scheduler is down.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans-audit";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { AttemptVerdict, ClaimExecutor } from "@/lib/org/followups";

export type { ClaimExecutor };

/** Why a claim was refused. Each is a fact about the CALLER's own row, never about another tenant. */
export type ClaimRefusal =
  /** Somebody else holds it on a live lease, or a human took it. */
  | "held"
  /** Not `open` — already done, dismissed, or in progress under a claim we just lost. */
  | "not-open"
  /** Unknown to this organization. Deliberately the same answer for "does not exist": a work door
   *  must not be an oracle for which recommendation ids exist in other tenants. */
  | "unknown";

/**
 * One claimed row as it crosses to a client. WIRE-SAFE: `leaseUntil` is an ISO string, mapped with
 * `.toISOString()` here — a `Date` would type-check in the ledger and throw at `getTime()`.
 */
export interface FollowupClaimRow {
  id: string;
  repo: string;
  title: string;
  claimActor: string | null;
  claimExecutor: ClaimExecutor | null;
  leaseUntil: string | null;
  needsHuman: boolean;
}

interface ClaimedRowShape {
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
  return {
    id: r.id,
    repo: r.scan.repo.fullName,
    title: r.title,
    claimActor: r.claimActor,
    claimExecutor: asExecutor(r.claimExecutor),
    leaseUntil: r.leaseUntil ? r.leaseUntil.toISOString() : null,
    needsHuman: r.needsHuman,
  };
}

const CLAIM_SELECT = {
  id: true,
  title: true,
  claimActor: true,
  claimExecutor: true,
  leaseUntil: true,
  needsHuman: true,
  scan: { select: { repo: { select: { fullName: true } } } },
} satisfies Prisma.RecommendationSelect;

/**
 * Return every `in_progress` row whose lease has PASSED to `open`, clearing the claim columns and
 * writing one timeline event each.
 *
 * `leaseUntil: { not: null }` is the load-bearing half of the predicate. A null lease on an
 * in-progress row means a human took it from the browser, which is an unleased claim with no clock
 * on it; sweeping those would silently pull work out from under a person the moment they walked away
 * from their desk.
 *
 * Returns the number released. `0` is the ordinary answer and is not an error.
 */
export async function sweepExpiredLeases(orgSlug: string, now: Date = new Date()): Promise<number> {
  if (!isDbConfigured()) return 0;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return 0;
  const prisma = getPrisma();

  const stale = await prisma.recommendation.findMany({
    where: {
      status: "in_progress",
      leaseUntil: { not: null, lt: now },
      scan: { repo: { orgId: org.id } },
    },
    select: { id: true, claimActor: true, leaseUntil: true },
  });
  if (stale.length === 0) return 0;

  let released = 0;
  for (const row of stale) {
    // Per-row compare-and-set again, and for the same reason the claim is one: between the read
    // above and this write the holder may have called `report_attempt` and cleared its own lease.
    // Guarding on the exact lease we read means a sweep never un-claims a row that moved on.
    const res = await prisma.recommendation.updateMany({
      where: { id: row.id, status: "in_progress", leaseUntil: row.leaseUntil },
      data: { status: "open", claimActor: null, claimExecutor: null, leaseUntil: null },
    });
    if (res.count !== 1) continue;
    released += 1;
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: row.id,
          actor: row.claimActor,
          kind: "status",
          fromValue: "in_progress",
          toValue: "open",
          note: `Lease expired — released back to the queue (held by ${row.claimActor ?? "an unnamed worker"}).`,
        },
      })
      .catch(() => null);
  }
  return released;
}

export interface ClaimFollowupsInput {
  org: string;
  ids: readonly string[];
  /** Who holds it — `agent:<token name>`, `autopilot`, a login. Stored verbatim in `claimActor`. */
  actor: string;
  executor: ClaimExecutor;
  /** Lease length. Pass `null` for an UNLEASED claim — the browser hand-off's shape, which the
   *  sweep must never reclaim. Never defaulted to a time: see `sweepExpiredLeases`. */
  leaseMs: number | null;
  note: string;
  /** The token that authorized a machine claim, for the audit row. Null for a local/human claim. */
  tokenId?: string | null;
}

export interface ClaimFollowupsResult {
  claimed: FollowupClaimRow[];
  refused: { id: string; reason: ClaimRefusal }[];
}

/**
 * Claim rows for `actor`. Compare-and-set per row; a row somebody else holds is REFUSED, never
 * stolen and never silently dropped.
 *
 * The refusal path is the point. A local lane whose batch is partly held by a remote agent works the
 * rest and logs what it could not take — before this, its unconditional update took all five, and the
 * agent's session then wrote into rows the lane also believed it owned.
 */
export async function claimFollowups(input: ClaimFollowupsInput): Promise<ClaimFollowupsResult | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(input.org);
  if (!org) return null;
  const prisma = getPrisma();
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) return { claimed: [], refused: [] };

  // Reclaim what lapsed BEFORE deciding what is available. Without this a crashed agent's rows stay
  // invisible until something else happens to sweep, which is the zombie the loop already knows.
  await sweepExpiredLeases(input.org).catch(() => 0);

  const now = new Date();
  const leaseUntil = input.leaseMs == null ? null : new Date(now.getTime() + input.leaseMs);

  // ONE org-scoped batch read for ownership. An id this org does not own is answered `unknown`, the
  // same word an id that does not exist gets — no existence oracle across tenants.
  const owned = await prisma.recommendation.findMany({
    where: { id: { in: ids }, scan: { repo: { orgId: org.id } } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((r) => r.id));

  const claimed: FollowupClaimRow[] = [];
  const refused: { id: string; reason: ClaimRefusal }[] = [];

  for (const id of ids) {
    if (!ownedIds.has(id)) {
      refused.push({ id, reason: "unknown" });
      continue;
    }
    // THE COMPARE-AND-SET. `status: "open"` plus an expired-or-absent lease is the candidate
    // predicate; two concurrent callers both pass it and exactly one `count` comes back 1.
    const res = await prisma.recommendation.updateMany({
      where: {
        id,
        status: "open",
        scan: { repo: { orgId: org.id } },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { status: "in_progress", claimActor: input.actor, claimExecutor: input.executor, leaseUntil },
    });
    if (res.count !== 1) {
      // CONSUME THE VERDICT HONESTLY: read back what beat us, so "held" and "not-open" are two
      // different facts the caller can act on differently.
      const nowRow = await prisma.recommendation.findUnique({ where: { id }, select: { status: true } });
      refused.push({ id, reason: nowRow?.status === "in_progress" ? "held" : "not-open" });
      continue;
    }
    const row = await prisma.recommendation.findUnique({ where: { id }, select: CLAIM_SELECT });
    if (row) claimed.push(toClaimRow(row as ClaimedRowShape));
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: id,
          actor: input.actor,
          kind: "status",
          fromValue: "open",
          toValue: "in_progress",
          note: leaseUntil
            ? `${input.note} (executor ${input.executor}; lease expires ${leaseUntil.toISOString()})`
            : `${input.note} (executor ${input.executor}; no lease)`,
        },
      })
      .catch(() => null);
  }

  // ONE audit row per accepted claim BATCH. This door is a machine write path, so it is audited like
  // every other one — and the org's audit viewer filters on `orgId`, which is why it is resolved
  // rather than left null (the mistake `updateRecommendation` had to be repaired for).
  if (claimed.length > 0) {
    await recordAudit(
      "followup.claim",
      {
        ids: claimed.map((c) => c.id),
        actor: input.actor,
        executor: input.executor,
        tokenId: input.tokenId ?? null,
        leaseUntil: leaseUntil ? leaseUntil.toISOString() : null,
      },
      { orgId: org.id },
    ).catch(() => false);
  }
  return { claimed, refused };
}

/**
 * Hand rows back. Only rows this actor still holds are released — a release that ignored the holder
 * would let a crashed lane's late cleanup un-claim work a different worker has since picked up.
 *
 * Returns how many were actually released.
 */
export async function releaseFollowups(ids: readonly string[], why: string, actor: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  let released = 0;
  for (const id of [...new Set(ids)]) {
    const res = await prisma.recommendation
      .updateMany({
        where: { id, status: "in_progress", claimActor: actor },
        data: { status: "open", claimActor: null, claimExecutor: null, leaseUntil: null },
      })
      .catch(() => ({ count: 0 }));
    if (res.count !== 1) continue;
    released += 1;
    await prisma.recommendationEvent
      .create({
        data: {
          recommendationId: id,
          actor,
          kind: "status",
          fromValue: "in_progress",
          toValue: "open",
          note: `Released: ${why}`,
        },
      })
      .catch(() => null);
  }
  return released;
}

export interface ReportAttemptInput {
  org: string;
  id: string;
  actor: string;
  verdict: AttemptVerdict;
  reason: string;
  branch?: string | null;
  prUrl?: string | null;
  tokenId?: string | null;
}

/**
 * Record what a worker says it did with ONE row it holds. Returns the row's state afterwards, or
 * `null` when the id is not this org's, is not held by this actor, or persistence is off.
 *
 * THE VERDICT TABLE — and every line of it is the same rule stated three ways: nothing here closes.
 *   • `resolved` → the row STAYS `in_progress`, the lease is cleared. The rescan owns it now; it
 *     closes when the gap stops being raised and the dimension moves. An agent's "I fixed it" is
 *     exactly as much of a claim as the commit trailer it also wrote.
 *   • `skipped` → back to `open`, lease cleared, claim columns cleared. The work was not done, so
 *     the row belongs to whoever comes next rather than to the session that walked away from it.
 *   • `needs_human` → stays `in_progress` with `needsHuman = true` and no lease. The agent tried and
 *     stopped DELIBERATELY, which is a different fact from a lapsed lease, and the flag is an
 *     escalation rather than a status: the work is visibly still open rather than quietly closed by
 *     a machine that gave up.
 */
export async function reportAttempt(input: ReportAttemptInput): Promise<FollowupClaimRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(input.org);
  if (!org) return null;
  const prisma = getPrisma();

  const held = await prisma.recommendation.findFirst({
    where: { id: input.id, claimActor: input.actor, status: "in_progress", scan: { repo: { orgId: org.id } } },
    select: { id: true },
  });
  if (!held) return null;

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
    // Guarded on the holder again inside the transaction: the read above and this write must not
    // straddle a sweep that released the row to somebody else.
    const res = await tx.recommendation.updateMany({
      where: { id: input.id, status: "in_progress", claimActor: input.actor },
      data,
    });
    if (res.count !== 1) return null;
    await tx.recommendationEvent.create({
      data: {
        recommendationId: input.id,
        actor: input.actor,
        // `attempt` is the row's own vocabulary for "the worker's account", distinct from `status`
        // (what the ledger did) — so a reader can tell a claim apart from a ruling in the timeline.
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
 * claimed by somebody else is refused BY ID rather than silently dropped, so an agent asking for five
 * briefs and getting three knows which two it lost.
 */
export async function heldFollowups(orgSlug: string, ids: readonly string[], actor: string): Promise<FollowupClaimRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().recommendation.findMany({
    where: {
      id: { in: [...new Set(ids)] },
      claimActor: actor,
      status: "in_progress",
      scan: { repo: { orgId: org.id } },
    },
    select: CLAIM_SELECT,
  });
  return rows.map((r) => toClaimRow(r as ClaimedRowShape));
}
