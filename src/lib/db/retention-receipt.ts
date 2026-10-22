// The retention receipt read: the newest `retention.purged` and `retention.updated` audit rows for
// ONE org, so the Settings card can say whether a purge removed anything since the policy was saved.
//
// Scoped by the org's own id on every query. An unknown slug reads nothing (never an org-less or
// cross-org fallback); the orphan sweep's org-less `retention.purged` rows are therefore never seen.
// Read-only: it deletes nothing and changes no policy. Timestamps cross to the client as ISO strings
// (wire-safe dates). Callers are already behind the Settings tab's owner gate.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { PURGE_ACTION } from "./retention-policy";

/** The action a policy save writes (src/app/api/org/retention/route.ts). */
export const RETENTION_UPDATED_ACTION = "retention.updated";

export interface RetentionReceiptRow {
  at: string;
  meta: Record<string, unknown>;
}

export interface RetentionReceipt {
  lastPurge: RetentionReceiptRow | null;
  lastSave: RetentionReceiptRow | null;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getRetentionReceipt(slug: string): Promise<RetentionReceipt | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(slug);
  if (!orgId) return null;
  const prisma = getPrisma();
  const newest = async (action: string): Promise<RetentionReceiptRow | null> => {
    const row = await prisma.auditLog.findFirst({
      where: { orgId, action },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { at: true, meta: true },
    });
    return row ? { at: row.at.toISOString(), meta: parseMeta(row.meta) } : null;
  };
  const [lastPurge, lastSave] = await Promise.all([newest(PURGE_ACTION), newest(RETENTION_UPDATED_ACTION)]);
  return { lastPurge, lastSave };
}
