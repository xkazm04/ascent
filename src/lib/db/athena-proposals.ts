// ATHENA'S OPEN ASKS — the things she proposed that a human has not answered yet.
//
// A proposal is the seam between "she said something" and "something happened". Nothing she suggests
// takes effect until a person accepts it here, and the acceptance is recorded with WHO and WHEN.
//
// THE OUTCOME IS MERGED INTO `payloadJson`, and there is deliberately no `outcome` column. An outcome
// is kind-shaped — a loop-run id for one action, an anchored-diff result for `identity_diff`, a
// refusal reason for a diff that missed — and a single column would have to be either a second JSON
// blob (two blobs, one table) or a lowest-common-denominator string that throws away the half a
// reader actually needs. The payload already IS the shape-carrying field; the outcome belongs in it.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export const ATHENA_PROPOSAL_STATUSES = ["open", "accepted", "declined"] as const;
export type AthenaProposalStatus = (typeof ATHENA_PROPOSAL_STATUSES)[number];

/** `kind` is an action id (the action an acceptance would run) or this, a change to her self-model. */
export const IDENTITY_DIFF_KIND = "identity_diff";

export interface AthenaProposalRecord {
  id: string;
  orgId: string;
  threadId: string;
  turnId: string;
  kind: string;
  /** The ask — and, once resolved, its outcome merged in under `outcome`. */
  payload: Record<string, unknown>;
  status: AthenaProposalStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

type Row = {
  id: string;
  orgId: string;
  threadId: string;
  turnId: string;
  kind: string;
  payloadJson: string;
  status: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const asStatus = (s: string): AthenaProposalStatus =>
  (ATHENA_PROPOSAL_STATUSES as readonly string[]).includes(s) ? (s as AthenaProposalStatus) : "open";

const toRecord = (r: Row): AthenaProposalRecord => ({
  id: r.id,
  orgId: r.orgId,
  threadId: r.threadId,
  turnId: r.turnId,
  kind: r.kind,
  payload: parsePayload(r.payloadJson),
  status: asStatus(r.status),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  resolvedBy: r.resolvedBy,
  createdAt: r.createdAt.toISOString(),
});

export interface CreateProposalInput {
  orgId: string;
  threadId: string;
  turnId: string;
  kind: string;
  payload: Record<string, unknown>;
}

/** Raise a proposal against the assistant turn that made it. Starts `open` — nothing has happened. */
export async function createAthenaProposal(input: CreateProposalInput): Promise<AthenaProposalRecord | null> {
  if (!isDbConfigured() || !input.orgId || !input.threadId || !input.turnId || !input.kind.trim()) return null;
  const row = await getPrisma().athenaProposal.create({
    data: {
      orgId: input.orgId,
      threadId: input.threadId,
      turnId: input.turnId,
      kind: input.kind.trim(),
      payloadJson: JSON.stringify(input.payload ?? {}),
    },
  });
  return toRecord(row);
}

/** Everything still awaiting an answer in this org — the badge query the `[orgId, status]` index serves. */
export async function listOpenAthenaProposals(orgId: string, limit = 50): Promise<AthenaProposalRecord[]> {
  if (!isDbConfigured() || !orgId) return [];
  const rows = await getPrisma().athenaProposal.findMany({
    where: { orgId, status: "open" },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, Math.round(limit))),
  });
  return rows.map(toRecord);
}

/** One thread's proposals (any status), oldest first so they line up with the transcript. */
export async function listThreadAthenaProposals(orgId: string, threadId: string): Promise<AthenaProposalRecord[]> {
  if (!isDbConfigured() || !orgId || !threadId) return [];
  const rows = await getPrisma().athenaProposal.findMany({
    where: { orgId, threadId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
}

/** One proposal, ANDed with `orgId` — a proposal id alone never crosses a tenant boundary. */
export async function getAthenaProposal(orgId: string, id: string): Promise<AthenaProposalRecord | null> {
  if (!isDbConfigured() || !orgId || !id) return null;
  const row = await getPrisma().athenaProposal.findFirst({ where: { id, orgId } });
  return row ? toRecord(row) : null;
}

/**
 * Answer a proposal. The outcome is MERGED INTO the payload (see the header) under `outcome`, beside
 * the ask it answers, so reading one row tells you both what was proposed and what came of it.
 *
 * `updateMany` with `status: "open"` in the where-clause makes this a compare-and-set: a second
 * accept that races the first changes nothing and reports `null`, rather than re-running an action.
 */
export async function resolveAthenaProposal(
  orgId: string,
  id: string,
  status: Exclude<AthenaProposalStatus, "open">,
  resolvedBy: string | null,
  outcome?: Record<string, unknown>,
): Promise<AthenaProposalRecord | null> {
  if (!isDbConfigured() || !orgId || !id) return null;
  const prisma = getPrisma();
  const current = await prisma.athenaProposal.findFirst({ where: { id, orgId, status: "open" } });
  if (!current) return null;

  const payload = { ...parsePayload(current.payloadJson), ...(outcome ? { outcome } : {}) };
  const { count } = await prisma.athenaProposal.updateMany({
    where: { id, orgId, status: "open" },
    data: { status, resolvedAt: new Date(), resolvedBy, payloadJson: JSON.stringify(payload) },
  });
  if (count === 0) return null; // lost the race — the other resolver's outcome stands
  const row = await prisma.athenaProposal.findFirst({ where: { id, orgId } });
  return row ? toRecord(row) : null;
}

// ── claim → run → stamp ─────────────────────────────────────────────────────────────────────────
//
// {@link resolveAthenaProposal} is the ONE-SHOT resolution: it is right for a decline, where there is
// nothing to run. An ACCEPT has work in the middle of it, and the ordering of that work is the whole
// problem. Write-then-work leaves a failed accept marked done. Work-then-write runs a double-click
// twice. So an accept is three guarded steps, each of which can only ever move the row one way:
//
//   claim    status = 'open'                        → one caller wins; a second sees nothing and 409s
//   stamp    resolvedAt IS NULL                     → merges the outcome in, and closes the row
//   release  status = 'accepted' AND resolvedAt NULL → can ONLY undo a claim, never a resolution
//
// A RESOLVED PROPOSAL CAN NEVER BE RE-OPENED, RE-STAMPED OR FLIPPED. `resolvedAt IS NULL` in the stamp
// and in the release is what guarantees it, and it is why reopening a conversation is safe: the card
// reads its status from the live row, so a resolved proposal paints an OUTCOME rather than a second
// Accept button.

/**
 * Step 1. `open → accepted` with `resolvedAt` still NULL — the row is claimed, nothing has run yet.
 * Returns the claimed record, or null when another caller already took it (the 409).
 */
export async function claimAthenaProposal(
  orgId: string,
  id: string,
  claimedBy: string | null,
): Promise<AthenaProposalRecord | null> {
  if (!isDbConfigured() || !orgId || !id) return null;
  const prisma = getPrisma();
  const { count } = await prisma.athenaProposal.updateMany({
    where: { id, orgId, status: "open" },
    data: { status: "accepted", resolvedBy: claimedBy },
  });
  if (count === 0) return null;
  const row = await prisma.athenaProposal.findFirst({ where: { id, orgId } });
  return row ? toRecord(row) : null;
}

/**
 * Step 3. Merge the outcome into `payloadJson` and stamp `resolvedAt`, closing the row for good.
 * Guarded on `resolvedAt IS NULL`, so a stamp can never overwrite a resolution that already stands.
 * `status` may be corrected here (an accept whose action turned out to be retired resolves as
 * `declined`), but only while the row is still unstamped.
 */
export async function stampAthenaProposal(
  orgId: string,
  id: string,
  outcome: Record<string, unknown>,
  status?: Exclude<AthenaProposalStatus, "open">,
): Promise<AthenaProposalRecord | null> {
  if (!isDbConfigured() || !orgId || !id) return null;
  const prisma = getPrisma();
  const current = await prisma.athenaProposal.findFirst({ where: { id, orgId, resolvedAt: null } });
  if (!current) return null;

  const payload = { ...parsePayload(current.payloadJson), outcome };
  const { count } = await prisma.athenaProposal.updateMany({
    where: { id, orgId, resolvedAt: null },
    data: {
      ...(status ? { status } : {}),
      resolvedAt: new Date(),
      payloadJson: JSON.stringify(payload),
    },
  });
  if (count === 0) return null;
  const row = await prisma.athenaProposal.findFirst({ where: { id, orgId } });
  return row ? toRecord(row) : null;
}

/**
 * Undo a claim, and ONLY a claim. `status = 'accepted' AND resolvedAt IS NULL` is the entire safety
 * argument: a resolved row has a `resolvedAt` and is untouchable, and an open row is not accepted, so
 * the only state this can act on is one this very request created. Used when the work THREW — the
 * proposal goes back to open so the operator can click again.
 */
export async function releaseAthenaProposal(orgId: string, id: string): Promise<boolean> {
  if (!isDbConfigured() || !orgId || !id) return false;
  const { count } = await getPrisma().athenaProposal.updateMany({
    where: { id, orgId, status: "accepted", resolvedAt: null },
    data: { status: "open", resolvedBy: null },
  });
  return count > 0;
}
