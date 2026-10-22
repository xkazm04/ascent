// THE REAPER FOR ATHENA'S ASKS. Every hold a proposal can be in names what ends it, and this is the
// end for the two holds no request is coming back for:
//
//   stale claim  accepted, resolvedAt NULL, claimedAt older than ATHENA_CLAIM_STALE_MS (or NULL: a
//                claim taken before the column existed) -> stamped with an `interrupted` outcome and
//                closed. NEVER released back to open: the executor may have run, its outcome is
//                unknown, and record_memory is not idempotent, so a retry could write twice.
//   aged ask     open, createdAt older than ATHENA_PROPOSAL_TTL_DAYS -> status `expired`, closed, with
//                an `expired` outcome. Expiry is a WRITE with a recorded reason, never a read filter,
//                so the open list (and the cycle briefing built on it) simply stops returning it.
//
// Both writes are compare-and-sets on the same guards the resolver uses (`resolvedAt IS NULL`;
// `status = 'open'`), so a sweep that races a late stamp or a human click changes nothing it lost.
// The caller (cron/athena deps) writes the audit rows; this module knows only the org id.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { parsePayload } from "@/lib/db/athena-proposals";
import {
  ATHENA_CLAIM_STALE_MS,
  ATHENA_PROPOSAL_TTL_DAYS,
  OUTCOME_EXPIRED,
  OUTCOME_INTERRUPTED,
} from "@/lib/athena/proposal-lifecycle";
import type { OrgId } from "@/lib/org/ids";

/** Rows per hold per sweep. A backlog larger than this drains over successive daily runs. */
export const ATHENA_SWEEP_BATCH = 200;

export interface SweptProposal {
  id: string;
  threadId: string;
  kind: string;
}

export interface AthenaSweepResult {
  interrupted: SweptProposal[];
  expired: SweptProposal[];
}

const INTERRUPTED_DETAIL =
  "This action was claimed but its outcome was never recorded, so it was closed rather than retried. Check whether it took effect.";
const EXPIRED_DETAIL = `Nobody answered this within ${ATHENA_PROPOSAL_TTL_DAYS} days, so it was closed.`;

const swept = (r: { id: string; threadId: string; kind: string }): SweptProposal => ({
  id: r.id,
  threadId: r.threadId,
  kind: r.kind,
});

export async function sweepAthenaProposals(orgId: OrgId, nowMs: number = Date.now()): Promise<AthenaSweepResult> {
  const result: AthenaSweepResult = { interrupted: [], expired: [] };
  if (!isDbConfigured() || !orgId) return result;
  const prisma = getPrisma();
  const now = new Date(nowMs);

  const staleClaims = await prisma.athenaProposal.findMany({
    where: {
      orgId,
      status: "accepted",
      resolvedAt: null,
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(nowMs - ATHENA_CLAIM_STALE_MS) } }],
    },
    take: ATHENA_SWEEP_BATCH,
  });
  for (const row of staleClaims) {
    const payload = {
      ...parsePayload(row.payloadJson),
      outcome: { ok: false, kind: OUTCOME_INTERRUPTED, detail: INTERRUPTED_DETAIL },
    };
    // Same guard as the stamp: only an unstamped claim. Status is left `accepted` - a human DID accept.
    const { count } = await prisma.athenaProposal.updateMany({
      where: { id: row.id, orgId, status: "accepted", resolvedAt: null },
      data: { resolvedAt: now, payloadJson: JSON.stringify(payload) },
    });
    if (count > 0) result.interrupted.push(swept(row));
  }

  const agedAsks = await prisma.athenaProposal.findMany({
    where: { orgId, status: "open", createdAt: { lt: new Date(nowMs - ATHENA_PROPOSAL_TTL_DAYS * 86_400_000) } },
    take: ATHENA_SWEEP_BATCH,
  });
  for (const row of agedAsks) {
    const payload = {
      ...parsePayload(row.payloadJson),
      outcome: { ok: false, kind: OUTCOME_EXPIRED, detail: EXPIRED_DETAIL },
    };
    const { count } = await prisma.athenaProposal.updateMany({
      where: { id: row.id, orgId, status: "open" },
      data: { status: "expired", resolvedAt: now, resolvedBy: null, payloadJson: JSON.stringify(payload) },
    });
    if (count > 0) result.expired.push(swept(row));
  }

  return result;
}
