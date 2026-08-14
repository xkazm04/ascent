// The in-app alert history — one row per alert the product DECIDED to raise, whether or not a sink
// was configured or the POST succeeded. Deliberately its own table, not AuditLog: audit claim rows
// are DELETED on dispatch failure (releaseAuditClaim) and the whole trail is subject to
// retentionAuditDays purging, so an alert history built there would show fewer rows than attempts
// and no failures at all. Writers never throw (recordAudit's discipline): losing a history row must
// never suppress the alert itself or fail a scan.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

export type AlertEventKind =
  | "regression"
  | "promotion"
  | "security"
  | "low-credits"
  | "digest"
  | "goal-at-risk"
  | "spend-anomaly";

export interface AlertEventInput {
  kind: AlertEventKind;
  severity: "info" | "warning" | "critical" | "celebration";
  title: string;
  /** Plain-text body the sink got (or would have gotten). Truncated for storage sanity. */
  body?: string;
  repoFullName?: string | null;
  delivered: boolean;
  /** webhook | email; null/undefined when no sink resolved. */
  sinkKind?: "webhook" | "email" | null;
  /** Why nothing was sent: no-sink | cooldown | dispatch-failed. Omit when delivered. */
  suppressedReason?: "no-sink" | "cooldown" | "dispatch-failed" | null;
}

export interface AlertEventRow {
  id: string;
  kind: string;
  severity: string;
  repoFullName: string | null;
  title: string;
  delivered: boolean;
  sinkKind: string | null;
  suppressedReason: string | null;
  createdAt: string;
}

const BODY_CAP = 2000;

/** Best-effort write. Accepts a slug OR an already-resolved orgId ({ orgId }). Never throws. */
export async function recordAlertEvent(
  org: string | { orgId: string },
  input: AlertEventInput,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const prisma = getPrisma();
    const orgId = typeof org === "string" ? await getOrgId(org) : org.orgId;
    if (!orgId) return false;
    await prisma.alertEvent.create({
      data: {
        orgId,
        kind: input.kind,
        severity: input.severity,
        repoFullName: input.repoFullName ?? null,
        title: input.title,
        body: (input.body ?? "").slice(0, BODY_CAP),
        delivered: input.delivered,
        sinkKind: input.sinkKind ?? null,
        suppressedReason: input.delivered ? null : (input.suppressedReason ?? null),
      },
    });
    return true;
  } catch (err) {
    console.error("[alert-events] write failed (alert unaffected)", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Newest-first history for the alerts drawer. Null when DB-less (matches sibling readers). */
export async function listAlertEvents(orgSlug: string, limit = 30): Promise<AlertEventRow[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const prisma = getPrisma();
  const rows = await prisma.alertEvent.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, limit)),
    select: {
      id: true,
      kind: true,
      severity: true,
      repoFullName: true,
      title: true,
      delivered: true,
      sinkKind: true,
      suppressedReason: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
