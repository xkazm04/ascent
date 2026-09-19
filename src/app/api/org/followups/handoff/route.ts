// POST /api/org/followups/handoff  { org, ids: string[] }
//
// The write half of the follow-ups loop (src/lib/org/followups.ts): the user picked a batch and
// generated its fix prompt, so every picked item is now IN PROGRESS — "we took this on" — with a
// timeline note that says how. The prompt itself is built client-side from the same rows (pure), so
// this route only records the claim; nothing here talks to a model.
//
// Tenancy: `org` is authorized with requireOrgAccess, and every id is checked to BELONG to that org
// before it is touched — an id from another tenant is refused as a whole-request 403, not skipped,
// so a client can never learn which foreign ids exist by which ones "succeeded". The public funnel
// org is refused outright, as on the per-item PATCH: tracking is for your own org's scans.
//
// Idempotent on re-send: an item already in progress is left alone (no duplicate event); done /
// dismissed items are NOT reopened — a batch that includes a closed item is a stale selection, and
// the response says which ids were skipped so the ledger can refresh.
//
// The data work — one membership-scoped batch read, then CAS-guarded writes with the timeline +
// audit rows in the same transaction — lives in handoffRecommendations (the data layer owns the
// boundary); this route keeps only transport concerns. Spec:
// docs/specs/2026-08-30-followups-handoff-batch.md.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { handoffRecommendations } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;

export async function POST(request: Request) {
  const guard = dbGuard("Follow-ups", "Follow-up tracking requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as { org?: unknown; ids?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "Missing 'ids'." }, { status: 400 });
  if (ids.length > MAX_BATCH) return NextResponse.json({ error: `At most ${MAX_BATCH} items per hand-off.` }, { status: 400 });
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Follow-up tracking is available for your own organization's scans." }, { status: 403 });
  }
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const actor = await resolveViewerLogin();
  const outcome = await handoffRecommendations(org, ids, {
    actor,
    note: "Handed off: fix prompt generated from the Follow-ups ledger",
  });
  if (!outcome) return NextResponse.json({ error: "Follow-up tracking requires a database." }, { status: 503 });
  if (!outcome.ok) {
    // Unknown and foreign ids get the SAME whole-request refusal — no existence oracle.
    return NextResponse.json({ error: "One or more items do not belong to this organization." }, { status: 403 });
  }
  return NextResponse.json({ marked: outcome.marked, skipped: outcome.skipped });
}
