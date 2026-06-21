// PATCH /api/recommendations/:id  { status?, assigneeLogin?, targetDate?, note? }
//   -> updated PersistedRecommendation
// Applies an ownership/planning change to a recommendation — status (open | in_progress | done |
// dismissed), assignee (a GitHub login, or null to clear), and/or due date (YYYY-MM-DD, or null) —
// and records each change on the recommendation's activity timeline, attributed to the signed-in
// user. Back-compatible with the status-only body the per-repo report tracker sends.

import { NextResponse } from "next/server";
import { REC_STATUSES, type RecStatus } from "@/lib/types";
import { getRecommendationOrgSlug, isDbConfigured, updateRecommendation, type RecommendationPatch } from "@/lib/db";
import { getSession, isAuthConfigured, PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";

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
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Recommendation tracking requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }
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
  const session = isAuthConfigured() ? await getSession() : null;

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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one of: status, assigneeLogin, targetDate." },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  try {
    const updated = await updateRecommendation(id, patch, { actor: session?.login ?? null, note });
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
