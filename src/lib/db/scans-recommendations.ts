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

  const actor = opts.actor?.trim() || null;
  const note = opts.note?.trim() || null;
  const data: Prisma.RecommendationUpdateInput = {};
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
    const row = await tx.recommendation.update({ where: { id }, data });
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
        orgId: null,
        actorId: null,
      },
    });
    return row;
  });

  return toPersistedRec(updated);
}

/** Update only a recommendation's status (back-compat wrapper over updateRecommendation). */
export async function updateRecommendationStatus(
  id: string,
  status: RecStatus,
  opts: RecommendationActor = {},
): Promise<PersistedRecommendation | null> {
  return updateRecommendation(id, { status }, opts);
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
