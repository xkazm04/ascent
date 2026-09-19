// PATCH /api/recommendations/:id  { status?, assigneeLogin?, targetDate?, note? }
//   -> updated PersistedRecommendation
// Applies an ownership/planning change to a recommendation — status (open | in_progress | done |
// dismissed), assignee (a GitHub login, or null to clear), and/or due date (YYYY-MM-DD, or null) —
// and records each change on the recommendation's activity timeline, attributed to the signed-in
// user. Back-compatible with the status-only body the per-repo report tracker sends.
//
// `note` contract: an optional comment (≤ REC_NOTE_MAX_LENGTH chars — longer is a 400, never a
// silent truncation). It rides the FIRST change event of the patch; when the patch changes nothing
// (including a note-only body), it is written as a dedicated "note" timeline event — a note is
// never accepted and then silently discarded.

import { NextResponse } from "next/server";
import { REC_NOTE_MAX_LENGTH, REC_STATUSES, type RecStatus } from "@/lib/types";
import {
  clearRecommendationDismissal,
  getRecommendationOrgSlug,
  recordRecommendationDismissal,
  updateRecommendation,
  type RecommendationPatch,
} from "@/lib/db";
import { PUBLIC_ORG } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess } from "@/lib/authz";
import { isClosedRecStatus, recordRecommendationClose } from "@/lib/memory/scan-feed";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatchBody {
  status?: string;
  assigneeLogin?: string | null;
  targetDate?: string | null;
  note?: string | null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = dbGuard("Recommendation tracking", "Recommendation tracking requires a database (Phase 2 feature).");
  if (guard) return guard;
  const { id } = await ctx.params;
  // Tenant gate: authorize the caller against the org that OWNS this recommendation (resolved from the
  // row), not merely "is signed in" — otherwise any signed-in user could mutate another tenant's
  // backlog (status/assignee/due-date) and write to its audit log by guessing/lifting a rec id.
  const org = await getRecommendationOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
  // The shared "public" org is the anonymous free-scan funnel: requireOrgAccess is open for it (anyone
  // may scan a public repo). But that also meant ANY caller could mutate every public scan's
  // recommendation status/assignee/due-date and poison its shared event + audit trail. Public-funnel
  // recommendations are a read-only demo surface — tracking is for your own org's scans.
  if (org.trim().toLowerCase() === PUBLIC_ORG) {
    return NextResponse.json(
      { error: "Recommendation tracking is available for your own organization's scans." },
      { status: 403 },
    );
  }
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // Attribute the change to the signed-in user (recorded as the timeline actor).
  // resolveViewerLogin: the dormant custom-OAuth session is null under the ACTIVE Supabase wall,
  // so this actor was recorded as null in production.
  const actorLogin = await resolveViewerLogin();

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const patch: RecommendationPatch = {};

  if (body.status !== undefined) {
    if (!REC_STATUSES.includes(body.status as RecStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Expected one of: ${REC_STATUSES.join(", ")}.` },
        { status: 400 },
      );
    }
    patch.status = body.status as RecStatus;
  }

  if (body.assigneeLogin !== undefined) {
    if (body.assigneeLogin !== null && typeof body.assigneeLogin !== "string") {
      return NextResponse.json({ error: "assigneeLogin must be a string or null." }, { status: 400 });
    }
    // Keep it to a sane GitHub-login shape so the field can't be used as free-text storage.
    const login = body.assigneeLogin?.trim() ?? "";
    if (login && !/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      return NextResponse.json({ error: "assigneeLogin must be a valid GitHub login." }, { status: 400 });
    }
    patch.assigneeLogin = login || null;
  }

  if (body.targetDate !== undefined) {
    // Enforce the documented YYYY-MM-DD contract, not merely "Date.parse-able": the old check accepted
    // "June 9 2026", a full ISO datetime, "2026/06/09", etc. (implementation-dependent) and stored them
    // verbatim despite the type + error message promising a date-only ISO string. Require the exact
    // shape AND a real calendar date (so "2026-13-45" is rejected).
    if (
      body.targetDate !== null &&
      (typeof body.targetDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate) ||
        Number.isNaN(Date.parse(body.targetDate)))
    ) {
      return NextResponse.json({ error: "targetDate must be an ISO date (YYYY-MM-DD) or null." }, { status: 400 });
    }
    patch.targetDate = body.targetDate;
  }

  // The note contract (roadmap-recommendation-tracking 07-16 #1): a note is never silently lost.
  // It must be a string; an over-long note is REJECTED (the old silent .slice(0, 500) ate the tail
  // with a 200), and a note-only body is a valid patch — it becomes a dedicated "note" timeline
  // event instead of the old 400.
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string or null." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : null;
  if (note && note.length > REC_NOTE_MAX_LENGTH) {
    return NextResponse.json(
      { error: `note must be at most ${REC_NOTE_MAX_LENGTH} characters (got ${note.length}).` },
      { status: 400 },
    );
  }

  if (Object.keys(patch).length === 0 && !note) {
    return NextResponse.json(
      { error: "Provide at least one of: status, assigneeLogin, targetDate, note." },
      { status: 400 },
    );
  }

  try {
    const updated = await updateRecommendation(id, patch, { actor: actorLogin, note });
    // Auto-feed Shared Org Memory: a gap actually CLOSED is org intelligence, and until now it lived
    // only in this recommendation's private event timeline. Fires on the persisted post-state (so a
    // rejected/no-op patch can't record a close), resolves org + repo itself, is never-throwing, and
    // dedups on content — a retried PATCH or a double-click writes one row, not two.
    if (isClosedRecStatus(patch.status) && updated && isClosedRecStatus(updated.status)) {
      await recordRecommendationClose(id, { title: updated.title, dimension: updated.dimension });
    }
    // The dismissal counterpart. `done` feeds Shared Org Memory (above); `dismissed` feeds the
    // STANDING DECISIONS block the next scan's prompt reads — so "we're not doing this, we're on
    // Bazel" reaches the assessment instead of dying in this row's event timeline and the identical
    // gap being re-raised. The reason is the patch's `note`; a dismissal without one records nothing
    // (silence must never become permanent suppression). Moving OUT of dismissed reopens the standing
    // decision, so an un-dismissed gap stops being suppressed. Both are never-throwing.
    if (patch.status !== undefined && updated) {
      if (updated.status === "dismissed") {
        await recordRecommendationDismissal(
          id,
          { title: updated.title, dimension: updated.dimension, reason: note },
          actorLogin,
        );
      } else {
        await clearRecommendationDismissal(
          id,
          { title: updated.title, dimension: updated.dimension },
          actorLogin,
        );
      }
    }
    return NextResponse.json(updated);
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    }
    // Optimistic-lock conflict: a concurrent edit changed the row since it was read. Return 409 so the
    // client refetches the current state and retries, rather than the server silently overwriting it.
    if ((err as { code?: string }).code === "REC_CONFLICT") {
      return NextResponse.json(
        { error: "This recommendation changed since you loaded it. Refresh and try again." },
        { status: 409 },
      );
    }
    console.error("[recommendations] update failed", err);
    return NextResponse.json({ error: "Failed to update recommendation." }, { status: 500 });
  }
}
