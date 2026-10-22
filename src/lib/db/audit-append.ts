// The ONE audit-ledger write door. Every insert into AuditLog (and the erasure redaction, the only
// legitimate in-place update) builds its row here, so the invariants live in one place instead of
// being re-explained at every writer:
//
//  - ONE clock: `at` is stamped once and is both the value SIGNED (canonical() covers createdAt) and the
//    value STORED. Letting the DB default the timestamp would sign a different instant than the row
//    carries, and the row would verify as `tampered` forever.
//  - SIGNED: the caller meta gets its per-row HMAC `_sig` folded in (inert without a signing secret,
//    exactly as audit-integrity.ts degrades), then is JSON-stringified into AuditLog.meta.
//  - A batch shares ONE instant: rows committed in one transaction carry the same truthful `at`.
//
// Four writers were found unsigned one at a time before this door existed; the guard in
// audit-writes.contract.test.ts fails if a new one bypasses it. The writers take the prisma client OR a
// transaction client, so in-transaction writes keep their atomicity.

import type { Prisma } from "@prisma/client";
import { redactAuditIdentity, withAuditSignature } from "@/lib/db/audit-integrity";

/** What a writer supplies: the tamper-sensitive content, without `at` (the door stamps it). */
export interface AuditAppendFields {
  action: string;
  orgId: string | null;
  actorId: string | null;
  /** The caller meta, WITHOUT any `_sig` field. */
  meta: Record<string, unknown>;
}

/** The exact `data` object written to AuditLog. */
export interface AuditRowData {
  action: string;
  orgId: string | null;
  actorId: string | null;
  at: Date;
  meta: string;
}

/** The prisma client or a `$transaction` client: anything exposing the AuditLog delegate. */
export type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

/** Pure: stamp (or take) the instant, sign over it, stringify. */
export function auditRowData(f: AuditAppendFields, at: Date = new Date()): AuditRowData {
  const signedMeta = withAuditSignature({
    action: f.action,
    orgId: f.orgId,
    actorId: f.actorId,
    createdAt: at.toISOString(),
    meta: f.meta,
  });
  return { action: f.action, orgId: f.orgId, actorId: f.actorId, at, meta: JSON.stringify(signedMeta) };
}

/** Pure: a batch of rows, every one stamped with (and signed over) the SAME shared instant. */
export function auditRowsData(batch: AuditAppendFields[], sharedAt: Date = new Date()): AuditRowData[] {
  return batch.map((f) => auditRowData(f, sharedAt));
}

/** Append one signed row; returns the new row's id. */
export async function appendAudit(
  client: AuditClient,
  fields: AuditAppendFields,
  opts: { at?: Date } = {},
): Promise<string> {
  const row = await client.auditLog.create({ data: auditRowData(fields, opts.at), select: { id: true } });
  return row.id;
}

/** Append a batch of signed rows over one shared instant (one createMany). */
export async function appendAuditBatch(
  client: AuditClient,
  batch: AuditAppendFields[],
  sharedAt: Date = new Date(),
): Promise<void> {
  if (batch.length === 0) return;
  await client.auditLog.createMany({ data: auditRowsData(batch, sharedAt) });
}

/**
 * The erasure redaction: reduce one stored row to identifier-only form and RE-SIGN it over its own
 * stored instant (see redactAuditIdentity in audit-integrity.ts for why re-signing is the right call).
 */
export async function redactAuditRow(
  client: AuditClient,
  row: { id: string; action: string; orgId: string | null; at: Date | string },
  redactedAt: string,
): Promise<void> {
  const redacted = redactAuditIdentity(
    { action: row.action, orgId: row.orgId, createdAt: new Date(row.at).toISOString() },
    redactedAt,
  );
  await client.auditLog.update({
    where: { id: row.id },
    data: { actorId: redacted.actorId, meta: JSON.stringify(redacted.meta) },
  });
}
