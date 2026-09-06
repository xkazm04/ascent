// Audit-trail writes + the org-dashboard audit-log query (keyset-paginated, scan-enriched).

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { resolveOrgId } from "@/lib/db/scans-shared";
import { getOrgId } from "@/lib/db/org-rollup";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { withAuditSignature, verifyAudit, type AuditVerdict } from "@/lib/db/audit-integrity";
import { noteAuditWriteFailure } from "@/lib/db/audit-health";

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
    // Count it before logging: a server log is not a surface anyone watches, and this is the only
    // record that the trail now has a hole (see audit-health.ts).
    noteAuditWriteFailure(action, err);
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

/**
 * Audit an org-scoped action: resolve the org's id from its slug (best-effort — a failed/absent lookup
 * leaves `orgId` undefined so the entry still records, just without the FK) and forward to
 * {@link recordAudit}. The single home for the "resolve orgId, then audit on success" tail that every
 * owner-gated org mutation repeats, so the audit envelope stays uniform across those routes.
 */
export async function recordOrgAudit(
  action: string,
  slug: string,
  meta: Record<string, unknown>,
  actorId?: string,
): Promise<boolean> {
  const orgId = (await getOrgId(slug).catch(() => null)) ?? undefined;
  return recordAudit(action, meta, { orgId, actorId });
}

/**
 * The action a RELEASE writes. It is a real audit row, not a tombstone column: the ledger is
 * append-only, so "this claim was cancelled because the guarded side effect failed" has to be
 * expressed as its own record pointing back at the claim.
 */
export const AUDIT_CLAIM_RELEASED_ACTION = "claim.released";

/** Meta key on a `claim.released` row holding the id of the AuditLog claim it cancels. */
export const RELEASED_CLAIM_ID_KEY = "releasedClaimId";

/**
 * The ids of claims cancelled by a `claim.released` row in this org at/after `since`. AuditLog.meta is a
 * JSON *string* column, so the reference can't be filtered in SQL portably — the release rows for one
 * org-window are a handful at most (one per failed dispatch), so they're read and parsed here.
 * `at >= since` is safe: a release is always written after the claim it cancels, and the claim itself
 * is in-window by construction.
 */
async function releasedClaimIds(
  tx: Prisma.TransactionClient,
  orgId: string,
  since: Date,
): Promise<Set<string>> {
  const rows = await tx.auditLog.findMany({
    where: { action: AUDIT_CLAIM_RELEASED_ACTION, orgId, at: { gte: since } },
    select: { meta: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const ref = parseMeta(r.meta)[RELEASED_CLAIM_ID_KEY];
    if (typeof ref === "string") ids.add(ref);
  }
  return ids;
}

/** The outcome of an atomic once-per-window audit claim (see {@link claimOrgAuditOnce}). */
export interface AuditClaim {
  /** True when THIS caller inserted the marker (won the window). False when one already existed — a
   *  concurrent run / retry beat us, so the caller must NOT perform the once-only side effect. */
  claimed: boolean;
  /** The inserted marker's id when we claimed — pass to {@link releaseAuditClaim} to UNDO the claim if
   *  the guarded side effect (e.g. the digest POST) then fails, so the next run retries. null otherwise. */
  id: string | null;
}

/**
 * Atomically claim a once-per-window org action (fleet-alerts-digests #3). The digest cron's old guard
 * was check-then-ACT — read getAuditLog, dispatch, THEN recordOrgAudit after the send — so two
 * overlapping runs (a platform retry, a re-fired schedule) both read "not sent", both dispatched, and an
 * org received the SAME weekly digest twice; a crash between the send and the stamp did the same on the
 * next run. This collapses the read+write into ONE conditional insert whose affected-row count decides
 * the winner: insert the marker only when no LIVE entry for (action, orgId) exists at/after `since` — a
 * marker cancelled by a `claim.released` row (see {@link releaseAuditClaim}) is not live. The
 * find-then-create runs inside a transaction wrapped in withRetry, so on Aurora DSQL two racing claims
 * conflict on their overlapping read/write sets and the loser re-runs, sees the winner's marker, and
 * returns claimed:false (rather than both inserting). Fails CLOSED (claimed:false) when persistence is
 * off, the org can't be resolved, or the write errors — a missed positive-push digest self-heals next
 * window, whereas sending without a durable claim would reintroduce the duplicate this fix removes.
 */
export async function claimOrgAuditOnce(
  action: string,
  slug: string,
  since: Date,
  meta: Record<string, unknown>,
  actorId?: string,
): Promise<AuditClaim> {
  if (!isDbConfigured()) return { claimed: false, id: null };
  const orgId = (await getOrgId(slug).catch(() => null)) ?? null;
  if (!orgId) return { claimed: false, id: null }; // unknown org → can't scope an at-most-once marker
  const prisma = getPrisma();
  try {
    return await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          // Read the window's markers and the release rows that CANCEL them, then insert — the same
          // read-then-conditional-create ordering the delete-based version had, only with a wider read.
          //
          // THE RACE WINDOW, honestly: nothing in the schema enforces at-most-once (no unique index on
          // (action, orgId, window) — that shape isn't expressible against an open-ended `at >= since`).
          // The guarantee is the ENGINE's: both statements run in ONE transaction, so on an
          // optimistic-concurrency store (Aurora DSQL) two racing claims have overlapping read/write
          // sets, one commit is rejected, and withRetry re-runs the loser, which now SEES the winner's
          // marker and returns claimed:false. Under a snapshot/read-committed engine with no such
          // conflict detection, two transactions can both read "no live marker" and both insert; that
          // was equally true before this change. Widening the read (findMany + release rows) can only
          // make the read set larger, so conflict detection is at least as strong as it was.
          const markers = await tx.auditLog.findMany({
            where: { action, orgId, at: { gte: since } },
            select: { id: true },
          });
          const released = markers.length ? await releasedClaimIds(tx, orgId, since) : new Set<string>();
          const existing = markers.find((m) => !released.has(m.id)) ?? null;
          if (existing) return { claimed: false, id: null };
          const at = new Date();
          const signedMeta = withAuditSignature({ action, orgId, actorId: actorId ?? null, createdAt: at.toISOString(), meta });
          const row = await tx.auditLog.create({
            data: { action, meta: JSON.stringify(signedMeta), orgId, actorId: actorId ?? null, at },
            select: { id: true },
          });
          return { claimed: true, id: row.id };
        }),
      { label: "audit.claim-once" },
    );
  } catch (err) {
    noteAuditWriteFailure(action, err);
    console.error("[db] claimOrgAuditOnce failed — treating as NOT claimed (fail-closed)", {
      action,
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return { claimed: false, id: null };
  }
}

/**
 * Release a claim from {@link claimOrgAuditOnce} when the guarded side effect FAILED, so the window is
 * not left falsely marked "done" and the next run retries it.
 *
 * This used to `auditLog.delete` the marker — the only delete on AuditLog outside retention purging, and
 * one that left NO trace: a successful release erased the fact that a dispatch had ever been attempted
 * and failed. An audit module exposes insert and read only; a correction is a NEW record referencing the
 * old one. So a release now APPENDS a signed `claim.released` row whose meta names the claim it cancels,
 * and {@link claimOrgAuditOnce} treats a claim with such a marker as not-live — the next window retries
 * exactly as it did before, and the trail keeps both halves of the story.
 *
 * Best-effort: a lost release at worst drops one window's side effect (recovered next window), never
 * spams. No-op for a null id / DB-less, and for an id that no longer resolves to a row.
 */
export async function releaseAuditClaim(id: string | null): Promise<void> {
  if (!id || !isDbConfigured()) return;
  try {
    const prisma = getPrisma();
    // The release row inherits the claim's org and actor so it lands in the SAME tenant trail the claim
    // did (an examiner filtering one org sees the cancellation next to the claim, not in a void).
    const claim = await prisma.auditLog.findUnique({
      where: { id },
      select: { id: true, action: true, orgId: true, actorId: true, at: true },
    });
    if (!claim) return;
    const at = new Date();
    const meta: Record<string, unknown> = {
      [RELEASED_CLAIM_ID_KEY]: claim.id,
      releasedAction: claim.action,
      releasedClaimAt: claim.at.toISOString(),
    };
    const signedMeta = withAuditSignature({
      action: AUDIT_CLAIM_RELEASED_ACTION,
      orgId: claim.orgId,
      actorId: claim.actorId,
      createdAt: at.toISOString(),
      meta,
    });
    await prisma.auditLog.create({
      data: {
        action: AUDIT_CLAIM_RELEASED_ACTION,
        meta: JSON.stringify(signedMeta),
        orgId: claim.orgId,
        actorId: claim.actorId,
        at,
      },
    });
  } catch (err) {
    noteAuditWriteFailure(AUDIT_CLAIM_RELEASED_ACTION, err);
    console.error("[db] releaseAuditClaim failed", { id, error: err instanceof Error ? err.message : String(err) });
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
  /** The tenant org id this row belongs to — a SIGNED field (see audit-integrity canonical()), so it
   *  must be present in any export for per-row HMAC verification to be reconstructable. */
  orgId: string | null;
  at: string; // ISO timestamp
  meta: Record<string, unknown>;
  scan: AuditScanRef | null;
  /**
   * Per-row tamper-evidence verdict, recomputed on READ from the row's own content.
   *
   * The HMAC has been written since audit-integrity landed, but nothing ever checked it: verification
   * was write-side only, which is not tamper-EVIDENCE — evidence requires someone to look. Recomputing
   * here means every surface that reads the trail (the API, the CSV export, the dashboard panel) states
   * a verdict, and a row altered at rest shows up as `tampered` instead of being served as fact.
   *
   * `unsigned` is a real and expected value, not a failure: rows written before signing landed, and rows
   * written through a path that bypasses withAuditSignature, carry no `_sig`. It must be rendered
   * distinctly from `ok` — "we cannot vouch for this row" is not "this row is fine".
   * `no-secret` means the deployment has no signing secret at all, so nothing can be verified.
   */
  integrity: AuditVerdict;
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

/**
 * Resolve the `until` upper bound. An <input type="date"> yields a date-only string ("YYYY-MM-DD"),
 * which `new Date()` parses as start-of-day UTC — so `lte` would exclude every entry recorded LATER
 * that same day, silently dropping the entire final day from the trail and the CSV export. Treat a
 * date-only value as an INCLUSIVE day bound by resolving it to the end of that UTC day; a full
 * timestamp (with a time component) is honored verbatim. Applied once here so both the on-screen
 * viewer and the CSV branch (which share getAuditLog) inherit the inclusive semantics.
 */
function resolveUntilBound(until: Date | string): Date {
  if (typeof until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return new Date(`${until}T23:59:59.999Z`);
  }
  return new Date(until);
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
  // Normalize the slug BEFORE resolving the org (security-posture-audit-log #4). The WRITE path
  // (recordOrgAudit → getOrgId → getOrgBySlug) already trims+lowercases, but resolveOrgId did NOT — so a
  // mixed-case slug reaching this read (`/org/MyOrg`, an API caller's raw casing) missed the canonical
  // lower-cased row, returned no orgId, and the whole trail + its CSV export came back EMPTY even though
  // the entries were written under the correct orgId. Normalizing here makes the read agree with the
  // write so those entries are no longer invisible.
  const orgId = await resolveOrgId(normalizeOrgSlug(orgSlug));
  if (!orgId) return { entries: [], nextCursor: null };

  const limit = Math.min(100, Math.max(1, query.limit ?? 25));

  const where: Prisma.AuditLogWhereInput = { orgId };
  if (query.action) where.action = query.action;
  if (query.actorId) where.actorId = query.actorId;
  const atFilter: Prisma.DateTimeFilter = {};
  if (query.since) atFilter.gte = new Date(query.since);
  if (query.until) atFilter.lte = resolveUntilBound(query.until);
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
      orgId: row.orgId,
      at: row.at.toISOString(),
      meta,
      scan: s
        ? { id: s.id, repo: s.repo?.fullName ?? null, level: s.level, overall: s.overallScore, headSha: s.headSha }
        : null,
      // Verified against the SAME canonical field set the writer signed (action/orgId/actorId/createdAt/
      // meta) — `at` is the stored timestamp, so it must be passed as the ISO string that was signed.
      integrity: verifyAudit({
        action: row.action,
        orgId: row.orgId,
        actorId: row.actorId,
        createdAt: row.at.toISOString(),
        meta,
      }),
    };
  });

  const last = pageRows[pageRows.length - 1];
  return { entries, nextCursor: hasMore && last ? encodeAuditCursor(last) : null };
}
