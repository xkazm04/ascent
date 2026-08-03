// Recommendation mutation + activity-timeline layer behind the backlog (status / assignee / due
// date edits, and the per-recommendation event history). The read-only "latest recommendations"
// query lives in scans-read.ts.

import type { PersistedRecommendation, RecEvent, RecEventKind, RecStatus } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { canonicalRepoFullName, DEFAULT_ORG_SLUG, resolveOrgId, toPersistedRec } from "@/lib/db/scans-shared";
import { findOrphanedTracked, type TrackedRecIdentity } from "@/lib/report/compare";

/** Parse a YYYY-MM-DD (or ISO) string to a Date, or null for empty/invalid input. */
function parseDateInput(v?: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** A YYYY-MM-DD key for a nullable date, so a target-date change only logs a real day change. */
function dateKey(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The fields of a recommendation a user can edit from the backlog. Each key present is applied;
 *  `assigneeLogin`/`targetDate` accept null to clear. Absent keys are left untouched. */
export interface RecommendationPatch {
  status?: RecStatus;
  assigneeLogin?: string | null;
  targetDate?: string | null;
}

/** Who made the change + an optional note. The note rides the FIRST resulting timeline event (not
 *  every event — the old per-event copy made one comment read as N comments); when nothing changed,
 *  it becomes a dedicated "note" event so it is never silently dropped. */
export interface RecommendationActor {
  actor?: string | null;
  note?: string | null;
}

/**
 * Apply a patch (status / assignee / due date) to a recommendation and append an activity-timeline
 * event for each field that actually changed — the ownership-and-history layer behind the backlog.
 * The row update and its events commit in one transaction, so the timeline can never disagree with
 * the current state. A no-op patch with no note writes nothing. A note always lands somewhere: on
 * the first change event, or — when the patch changed nothing — as a dedicated "note" event
 * (roadmap-recommendation-tracking #1: a 200 must never eat a note). Returns null if the DB is
 * disabled; throws Prisma's P2025 when the id doesn't exist (so the route can 404).
 */
export async function updateRecommendation(
  id: string,
  patch: RecommendationPatch,
  opts: RecommendationActor = {},
): Promise<PersistedRecommendation | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();

  // ONE read of the row AND its owning-org chain (Recommendation -> Scan -> Repository.orgId): the
  // patch/pre-image logic below reads the row's scalars, and the audit row's tenant scope reads the
  // joined orgId — both from a single findUnique instead of two reads of the same row.
  const current = await prisma.recommendation.findUnique({
    where: { id },
    include: { scan: { select: { repo: { select: { orgId: true } } } } },
  });
  if (!current) {
    // Mirror the P2025 a missing-row update would throw, so callers' not-found handling is uniform.
    throw new Prisma.PrismaClientKnownRequestError("Recommendation not found", {
      code: "P2025",
      clientVersion: Prisma.prismaVersion.client,
    });
  }

  // Resolve the owning org so the audit row below is READABLE. getAuditLog filters `where: { orgId }`,
  // so the old `orgId: null` made every backlog-mutation audit row durable but permanently invisible in
  // the audit viewer — re-opening the compliance gap the in-transaction audit was added to close. The
  // recommendation -> scan -> repo -> org chain is the tenant scope. (actorId stays null: the actor is
  // a login string carried in `meta`, not a resolvable User FK.)
  const orgId = current.scan?.repo?.orgId ?? null;

  const actor = opts.actor?.trim() || null;
  const note = opts.note?.trim() || null;
  const data: Prisma.RecommendationUpdateManyMutationInput = {};
  const events: Prisma.RecommendationEventCreateManyInput[] = [];
  const event = (kind: RecEventKind, from: string | null, to: string | null) =>
    events.push({ recommendationId: id, actor, kind, fromValue: from, toValue: to, note: null });

  if (patch.status !== undefined && patch.status !== current.status) {
    data.status = patch.status;
    event("status", current.status, patch.status);
  }

  if (patch.assigneeLogin !== undefined) {
    const next = patch.assigneeLogin?.trim() || null;
    if (next !== current.assigneeLogin) {
      data.assigneeLogin = next;
      event("assignee", current.assigneeLogin, next);
    }
  }

  if (patch.targetDate !== undefined) {
    const next = parseDateInput(patch.targetDate);
    if (dateKey(next) !== dateKey(current.targetDate)) {
      data.targetDate = next;
      event("target_date", dateKey(current.targetDate), dateKey(next));
    }
  }

  // A note must never be silently discarded: attach it to the FIRST change event only (the old
  // per-event copy duplicated one comment onto every event), or — when the patch changed nothing —
  // record it as a dedicated "note" timeline entry.
  if (note) {
    const first = events[0];
    if (first) first.note = note;
    else events.push({ recommendationId: id, actor, kind: "note", fromValue: null, toValue: null, note });
  }

  // Nothing actually changed and no note to record — don't write a no-op row update or an empty event.
  if (events.length === 0) return toPersistedRec(current);

  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic-concurrency guard: apply the update ONLY if the row still matches the pre-image we
    // read FOR THE FIELDS THIS PATCH WRITES. Two members editing the same row each read e.g.
    // status="open" and both pass the change checks above; a plain update({where:{id}}) then commits
    // last-write-wins, leaving the timeline + audit with BOTH transitions while the row reflects only
    // one (lost update + a self-contradicting compliance trail — the exact divergence the in-tx audit
    // was meant to prevent). Key the conditional update on the captured pre-image of ONLY the fields
    // present in `data` — guarding the whole editable tuple raised a FALSE conflict whenever ANY other
    // field moved concurrently (member A edits the assignee, member B the due date → B's where no
    // longer matched and B got a spurious 409 though their field never conflicted). count===0 now
    // means a concurrent write to one of THIS patch's own fields → throw a tagged conflict the route
    // surfaces as 409 (the whole tx, incl. events + audit, rolls back) so the client refetches and
    // retries, not silently overwrites.
    // A note-only write ("note" event, no field change) skips the row update entirely — there is
    // nothing to conflict with, and an empty-data updateMany would be a pointless write.
    if (Object.keys(data).length > 0) {
      const where: Prisma.RecommendationWhereInput = { id };
      if ("status" in data) where.status = current.status;
      if ("assigneeLogin" in data) where.assigneeLogin = current.assigneeLogin;
      if ("targetDate" in data) where.targetDate = current.targetDate;
      const res = await tx.recommendation.updateMany({ where, data });
      if (res.count === 0) {
        throw Object.assign(new Error("Recommendation changed concurrently — refresh and retry."), {
          code: "REC_CONFLICT",
        });
      }
    }
    await tx.recommendationEvent.createMany({ data: events });
    // Audit IN the same transaction (was a best-effort post-tx recordAudit that could leave a
    // committed status change with NO audit row — a compliance gap for the audit product). Mirrors
    // recordAudit's shape; now the audit row shares the mutation's atomicity (rolls back together).
    await tx.auditLog.create({
      data: {
        action: "recommendation.updated",
        meta: JSON.stringify({
          id,
          actor,
          changes: events.map((e) => ({ kind: e.kind, from: e.fromValue, to: e.toValue })),
        }),
        orgId,
        actorId: null,
      },
    });
    return tx.recommendation.findUniqueOrThrow({ where: { id } });
  });

  return toPersistedRec(updated);
}

/**
 * Resolve the org slug that owns a recommendation (Recommendation → Scan → Repository → Organization),
 * so a per-row route can authorize the CALLER against the recommendation's tenant before reading or
 * mutating it. Returns null when the recommendation doesn't exist (or the DB is off) → 404 / no access.
 */
export async function getRecommendationOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const rec = await getPrisma().recommendation.findUnique({
    where: { id },
    select: { scan: { select: { repo: { select: { org: { select: { slug: true } } } } } } },
  });
  return rec?.scan.repo.org.slug ?? null;
}

// ── Orphaned tracking (Direction 3) ──────────────────────────────────────────────────────────────

/** A previously-tracked recommendation the latest re-scan could not carry forward. */
export interface OrphanedTrackedRec extends TrackedRecIdentity {
  /** The scan the tracking was recorded against — the one before the current latest. */
  fromScanId: string;
}

/** Deterministic "latest first" — the SAME tiebreak scans-read/scans-persist use, so "previous"
 *  resolves to the row the carry-forward actually read from (a bare scannedAt desc can tie). */
const SCAN_ORDER: Prisma.ScanOrderByWithRelationInput[] = [
  { scannedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

const dateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * What the last re-scan silently dropped: tracked recommendations from the previous scan that the
 * tiered matcher could not pair with anything in the latest one.
 *
 * DERIVED, not stored. The two scans are already persisted and `findOrphanedTracked` is pure over
 * them, so there is no new column to migrate, backfill, or keep in sync — and no risk of a stored
 * orphan list disagreeing with the scans it describes. It also self-heals: re-linking an orphan
 * writes its tracking onto a row in the latest scan, and the next read stops reporting it.
 *
 * Returns `[]` when persistence is off, the repo is unknown, or there is only one scan — "nothing was
 * lost" and "we can't tell" both correctly produce no alarm here, because with one scan nothing was
 * ever carried.
 */
export async function getOrphanedTrackedRecommendations(
  owner: string,
  name: string,
  opts: { orgSlug?: string } = {},
): Promise<OrphanedTrackedRec[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return [];
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId, fullName: canonicalRepoFullName(owner, name) } },
    select: { id: true, isPrivate: true },
  });
  if (!repo) return [];
  // Same cross-tenant guard the sibling reads carry: assignee logins and target dates from a PRIVATE
  // repo must never be served out of the shared public (anonymous) org.
  if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return [];

  const scans = await prisma.scan.findMany({
    where: { repoId: repo.id },
    orderBy: SCAN_ORDER,
    take: 2,
    select: {
      id: true,
      recommendations: {
        select: { dimId: true, title: true, status: true, assigneeLogin: true, targetDate: true },
      },
    },
  });
  const [latest, previous] = scans;
  if (!latest || !previous) return [];

  const shape = (r: (typeof latest.recommendations)[number]): TrackedRecIdentity => ({
    dim: r.dimId,
    title: r.title,
    status: r.status,
    assigneeLogin: r.assigneeLogin,
    targetDate: dateOnly(r.targetDate),
  });

  return findOrphanedTracked(previous.recommendations.map(shape), latest.recommendations.map(shape)).map(
    (o) => ({ ...o, fromScanId: previous.id }),
  );
}

/**
 * A recommendation's activity timeline — every status / assignee / due-date change, newest first.
 * Returns null when persistence is disabled, or an empty array when the id has no recorded changes.
 */
export async function getRecommendationEvents(id: string): Promise<RecEvent[] | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().recommendationEvent.findMany({
    where: { recommendationId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((e) => ({
    id: e.id,
    actor: e.actor,
    kind: e.kind as RecEventKind,
    from: e.fromValue,
    to: e.toValue,
    note: e.note,
    at: e.createdAt.toISOString(),
  }));
}
