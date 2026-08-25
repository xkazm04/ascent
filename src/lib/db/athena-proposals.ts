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
