// Recommendation mutation + activity-timeline layer behind the backlog (status / assignee / due
// date edits, and the per-recommendation event history). The read-only "latest recommendations"
// query lives in scans-read.ts.

import type { PersistedRecommendation, RecEvent, RecEventKind, RecStatus } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { canonicalRepoFullName, DEFAULT_ORG_SLUG, resolveOrgId, toPersistedRec } from "@/lib/db/scans-shared";
import { findOrphanedTracked, type TrackedRecIdentity } from "@/lib/report/compare";
import { withAuditSignature } from "@/lib/db/audit-integrity";

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
        throw Object.assign(new Error("Recommendation changed concurrently; refresh and retry."), {
          code: "REC_CONFLICT",
        });
      }
    }
    await tx.recommendationEvent.createMany({ data: events });
    // Audit IN the same transaction (was a best-effort post-tx recordAudit that could leave a
    // committed status change with NO audit row — a compliance gap for the audit product). Mirrors
    // recordAudit's shape; now the audit row shares the mutation's atomicity (rolls back together).
    // SIGNED (exemplar: recordConformance in org-watch.ts): this write used to JSON.stringify its
    // meta directly, so every backlog mutation — the product's most-edited record — landed unsigned
    // and read as "unsigned" in the audit viewer's Integrity column. `at` is stamped explicitly
    // because canonical() signs createdAt; a DB-defaulted timestamp would sign a different instant
    // than the row stores and verify as `tampered`. actorId stays null (the actor is a login string
    // in `meta`, not a resolvable User FK) — and null is exactly what is signed.
    const auditAt = new Date();
    await tx.auditLog.create({
      data: {
        action: "recommendation.updated",
        at: auditAt,
        meta: JSON.stringify(
          withAuditSignature({
            action: "recommendation.updated",
            orgId,
            actorId: null,
            createdAt: auditAt.toISOString(),
            meta: {
              id,
              actor,
              changes: events.map((e) => ({ kind: e.kind, from: e.fromValue, to: e.toValue })),
            },
          }),
        ),
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

/** Outcome of a batch hand-off (spec: docs/specs/2026-08-30-followups-handoff-batch.md).
 *  `ok: false` = some requested id is unknown or foreign to the org — the caller refuses the WHOLE
 *  request (403), never a partial success, so foreign ids can't be enumerated by which "succeeded". */
export type HandoffOutcome =
  | { ok: true; marked: string[]; skipped: { id: string; status: string }[] }
  | { ok: false };

/**
 * Batch hand-off for the Follow-ups ledger: mark every `open` recommendation in `ids` as
 * `in_progress`, with a timeline event + audit row committing atomically with each status change.
 * One membership-scoped batch read answers ownership + current status (batching-and-n-plus-one:
 * a membership read is ONE `IN` query, not N singles); the writes are per-row conditional updates
 * whose WHERE carries the expected state (`status: "open"`) and the owning org, inside one
 * transaction (transactions-and-units-of-work: the read that feeds a write shares its boundary,
 * and the CAS verdict is consumed — a row that moved concurrently loses LOUDLY into `skipped`
 * instead of being silently reopened, which the old read-then-unguarded-write allowed).
 *
 * Idempotent per the route's contract: non-`open` rows (already in progress, done, dismissed) are
 * reported in `skipped` with their status and never touched. Returns null if the DB is disabled.
 */
export async function handoffRecommendations(
  orgSlug: string,
  ids: string[],
  opts: RecommendationActor = {},
): Promise<HandoffOutcome | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = orgSlug.trim().toLowerCase();

  // ONE membership-scoped batch read: ownership chain + current status for every requested id.
  const rows = await prisma.recommendation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      scan: { select: { repo: { select: { orgId: true, org: { select: { slug: true } } } } } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    // Unknown id and foreign id are the SAME refusal (no existence oracle), matching the old
    // per-id getRecommendationOrgSlug loop's comparison exactly (trimmed, lowercased).
    if (!row || row.scan.repo.org.slug.trim().toLowerCase() !== org) return { ok: false };
  }

  const actor = opts.actor?.trim() || null;
  const note = opts.note?.trim() || null;
  const candidates = ids.filter((id) => byId.get(id)!.status === "open");
  const skipped = ids
    .filter((id) => byId.get(id)!.status !== "open")
    .map((id) => ({ id, status: byId.get(id)!.status }));
  if (candidates.length === 0) return { ok: true, marked: [], skipped };

  // Audit tenant scope: every id was verified to belong to `org`, so one orgId covers the batch.
  const orgId = byId.get(candidates[0]!)!.scan.repo.orgId ?? null;

  const won = await prisma.$transaction(async (tx) => {
    const marked: string[] = [];
    const lost: { id: string; status: string }[] = [];
    for (const id of candidates) {
      // Per-row CAS: the WHERE carries the expected state AND ownership, so the write is
      // self-authorizing — count === 0 means the row moved (e.g. open → done) between the batch
      // read and this write, and it is SKIPPED, never reopened. Bounded by the route's MAX_BATCH.
      const res = await tx.recommendation.updateMany({
        where: { id, status: "open", scan: { repo: { orgId: orgId ?? undefined } } },
        data: { status: "in_progress" },
      });
      if (res.count === 1) {
        marked.push(id);
      } else {
        // Consume the verdict honestly: report the state that beat us.
        const now = await tx.recommendation.findUnique({ where: { id }, select: { status: true } });
        lost.push({ id, status: now?.status ?? "unknown" });
      }
    }
    if (marked.length > 0) {
      // Timeline + audit commit atomically WITH the status changes (the same invariant
      // updateRecommendation pins): one event and one audit row per marked id, in the shapes the
      // per-item path writes, so the timeline and audit viewer see identical rows.
      await tx.recommendationEvent.createMany({
        data: marked.map((recommendationId) => ({
          recommendationId,
          actor,
          kind: "status",
          fromValue: "open",
          toValue: "in_progress",
          note,
        })),
      });
      // SIGNED per row, over ONE shared `at` for the batch: these rows commit in a single
      // transaction, so one instant is the truthful timestamp for all of them — and it is the
      // instant each row's signature covers, since canonical() includes createdAt. (A DB-defaulted
      // timestamp would sign a different instant than the row stores → every row `tampered`.)
      // Before this, the batch hand-off wrote unsigned rows while the per-item path next to it
      // wrote signed ones for the SAME action.
      const auditAt = new Date();
      await tx.auditLog.createMany({
        data: marked.map((id) => ({
          action: "recommendation.updated",
          at: auditAt,
          meta: JSON.stringify(
            withAuditSignature({
              action: "recommendation.updated",
              orgId,
              actorId: null,
              createdAt: auditAt.toISOString(),
              meta: {
                id,
                actor,
                changes: [{ kind: "status", from: "open", to: "in_progress" }],
              },
            }),
          ),
          orgId,
          actorId: null,
        })),
      });
    }
    return { marked, lost };
  });

  return { ok: true, marked: won.marked, skipped: [...skipped, ...won.lost] };
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
 * Upper bound on one timeline read. The table is append-only and unbounded — every status flip,
 * reassignment, due-date change and dismissal note on one gap — behind a route any org reader can
 * call, so an unbounded `findMany` was a page-size an actor could grow by simply toggling a status.
 * 200 is far past a real triage history (a gap changing hands weekly for four years) while keeping
 * the read a bounded query, and the timeline is newest-first, so the truncated tail is the oldest
 * history, never the current state. The route reports the truncation rather than implying the list
 * is the whole record.
 */
export const REC_EVENTS_LIMIT = 200;

/**
 * A recommendation's activity timeline — every status / assignee / due-date change, newest first,
 * bounded at {@link REC_EVENTS_LIMIT}. Returns null when persistence is disabled, or an empty array
 * when the id has no recorded changes. A full page means there may be older events not returned.
 */
export async function getRecommendationEvents(id: string, limit = REC_EVENTS_LIMIT): Promise<RecEvent[] | null> {
  if (!isDbConfigured()) return null;
  const rows = await getPrisma().recommendationEvent.findMany({
    where: { recommendationId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
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
