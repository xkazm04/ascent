// Audit-trail writes + the org-dashboard audit-log query (keyset-paginated, scan-enriched).

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { resolveOrgId } from "@/lib/db/scans-shared";
import { withAuditSignature } from "@/lib/db/audit-integrity";

/**
 * Append an entry to the audit trail. Returns `true` when the entry was durably
 * recorded (or when persistence is disabled and there is nothing to record), and
 * `false` when the write was attempted but FAILED — so audit-critical callers can
 * react instead of pretending success. The failure is logged loudly with full
 * context (action, org, actor, meta) because a lost audit entry is a compliance gap.
 */
export async function recordAudit(
  action: string,
  meta: Record<string, unknown>,
  opts: { orgId?: string; actorId?: string } = {},
): Promise<boolean> {
  if (!isDbConfigured()) return true;
  try {
    // Stamp the time explicitly so the value we SIGN matches the value we STORE, then fold a per-row
    // HMAC signature into meta (migration-free tamper-evidence; inert without a signing secret).
    const at = new Date();
    const orgId = opts.orgId ?? null;
    const actorId = opts.actorId ?? null;
    const signedMeta = withAuditSignature({ action, orgId, actorId, createdAt: at.toISOString(), meta });
    await getPrisma().auditLog.create({
      data: {
        action,
        meta: JSON.stringify(signedMeta),
        orgId,
        actorId,
        at,
      },
    });
    return true;
  } catch (err) {
    console.error("[db] recordAudit FAILED — audit trail entry lost", {
      action,
      orgId: opts.orgId ?? null,
      actorId: opts.actorId ?? null,
      meta,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ---- Audit log query (org dashboard viewer) ---------------------------------

/** A scan referenced by an audit entry's meta — answers "who triggered the scan that
 *  moved a score". Null when the entry references no (still-present) scan. */
export interface AuditScanRef {
  id: string;
  repo: string | null;
  level: string | null;
  overall: number | null;
  headSha: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string | null;
  at: string; // ISO timestamp
  meta: Record<string, unknown>;
  scan: AuditScanRef | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Opaque keyset cursor for the next page, or null when there are no more entries. */
  nextCursor: string | null;
}

export interface AuditLogQuery {
  action?: string;
  actorId?: string;
  since?: Date | string;
  until?: Date | string;
  cursor?: string | null;
  limit?: number;
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Keyset cursor over the composite sort key (at desc, id desc). `at` alone isn't unique,
// so the id tie-breaker guarantees a stable, gap-free page boundary.
function encodeAuditCursor(row: { at: Date; id: string }): string {
  return Buffer.from(`${row.at.toISOString()}|${row.id}`).toString("base64url");
}

function decodeAuditCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/**
 * Read an org's audit trail with filters + keyset pagination, enriching each entry with
 * the scan it references (via meta.scanId) so a viewer can trace who triggered the scan
 * that moved a score. Org-scoped: only entries for `orgSlug` are returned. Returns null
 * when persistence is disabled, or an empty page when the org doesn't exist.
 */
export async function getAuditLog(
  orgSlug: string,
  query: AuditLogQuery = {},
): Promise<AuditLogPage | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return { entries: [], nextCursor: null };

  const limit = Math.min(100, Math.max(1, query.limit ?? 25));

  const where: Prisma.AuditLogWhereInput = { orgId };
  if (query.action) where.action = query.action;
  if (query.actorId) where.actorId = query.actorId;
  const atFilter: Prisma.DateTimeFilter = {};
  if (query.since) atFilter.gte = new Date(query.since);
  if (query.until) atFilter.lte = new Date(query.until);
  if (atFilter.gte || atFilter.lte) where.at = atFilter;

  const cursor = decodeAuditCursor(query.cursor);
  if (cursor) {
    where.OR = [{ at: { lt: cursor.at } }, { at: cursor.at, id: { lt: cursor.id } }];
  }

  // Fetch one extra row to detect whether another page exists.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const parsed = pageRows.map((r) => ({ row: r, meta: parseMeta(r.meta) }));
  const scanIds = [
    ...new Set(
      parsed
        .map((p) => (typeof p.meta.scanId === "string" ? p.meta.scanId : null))
        .filter((x): x is string => x != null),
    ),
  ];
  const scans = scanIds.length
    ? await prisma.scan.findMany({
        where: { id: { in: scanIds } },
        select: {
          id: true,
          level: true,
          overallScore: true,
          headSha: true,
          repo: { select: { fullName: true } },
        },
      })
    : [];
  const scanById = new Map(scans.map((s) => [s.id, s]));

  const entries: AuditLogEntry[] = parsed.map(({ row, meta }) => {
    const scanId = typeof meta.scanId === "string" ? meta.scanId : null;
    const s = scanId ? scanById.get(scanId) : undefined;
    return {
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      at: row.at.toISOString(),
      meta,
      scan: s
        ? { id: s.id, repo: s.repo?.fullName ?? null, level: s.level, overall: s.overallScore, headSha: s.headSha }
        : null,
    };
  });

  const last = pageRows[pageRows.length - 1];
  return { entries, nextCursor: hasMore && last ? encodeAuditCursor(last) : null };
}
