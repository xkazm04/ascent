// Recommendation mutation + activity-timeline layer behind the backlog (status / assignee / due
// date edits, and the per-recommendation event history). The read-only "latest recommendations"
// query lives in scans-read.ts.

import type { PersistedRecommendation, RecEvent, RecEventKind, RecStatus } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { toPersistedRec } from "@/lib/db/scans-shared";

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

/** Who made the change + an optional note, recorded on each resulting timeline event. */
export interface RecommendationActor {
  actor?: string | null;
  note?: string | null;
}

/**
 * Apply a patch (status / assignee / due date) to a recommendation and append an activity-timeline
 * event for each field that actually changed — the ownership-and-history layer behind the backlog.
 * The row update and its events commit in one transaction, so the timeline can never disagree with
 * the current state. A no-op patch (nothing actually changes) writes nothing. Returns null if the
 * DB is disabled; throws Prisma's P2025 when the id doesn't exist (so the route can 404).
 */
export async function updateRecommendation(
  id: string,
  patch: RecommendationPatch,
  opts: RecommendationActor = {},
): Promise<PersistedRecommendation | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();

  const current = await prisma.recommendation.findUnique({ where: { id } });
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
  const orgChain = await prisma.recommendation.findUnique({
    where: { id },
    select: { scan: { select: { repo: { select: { orgId: true } } } } },
  });
  const orgId = orgChain?.scan?.repo?.orgId ?? null;

  const actor = opts.actor?.trim() || null;
  const note = opts.note?.trim() || null;
  const data: Prisma.RecommendationUpdateManyMutationInput = {};
  const events: Prisma.RecommendationEventCreateManyInput[] = [];
  const event = (kind: RecEventKind, from: string | null, to: string | null) =>
    events.push({ recommendationId: id, actor, kind, fromValue: from, toValue: to, note });

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

  // Nothing actually changed — don't write a no-op row update or an empty event.
  if (events.length === 0) return toPersistedRec(current);

  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic-concurrency guard: apply the update ONLY if the row still matches the pre-image we
    // read. Two members editing the same row each read e.g. status="open" and both pass the change
    // checks above; a plain update({where:{id}}) then commits last-write-wins, leaving the timeline +
    // audit with BOTH transitions while the row reflects only one (lost update + a self-contradicting
    // compliance trail — the exact divergence the in-tx audit was meant to prevent). Key the
    // conditional update on the captured pre-image of every editable field; count===0 means a
    // concurrent write landed first → throw a tagged conflict the route surfaces as 409 (the whole
    // tx, incl. events + audit, rolls back) so the client refetches and retries, not silently overwrites.
    const res = await tx.recommendation.updateMany({
      where: {
        id,
        status: current.status,
        assigneeLogin: current.assigneeLogin,
        targetDate: current.targetDate,
      },
      data,
    });
    if (res.count === 0) {
      throw Object.assign(new Error("Recommendation changed concurrently — refresh and retry."), {
        code: "REC_CONFLICT",
      });
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
