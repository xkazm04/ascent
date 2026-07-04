// GET  /api/org/ops?org=slug                          -> OpsState (the wall's ship-loop panel)
// POST /api/org/ops { org, action: "accept"|"reject", id }  -> accept opens the starter PR
// POST /api/org/ops { org, action: "refresh" }              -> monitor tick: PR states + verify pass
//
// The live war-room's improvement loop. Reads are member-visible (the same data the backlog shows);
// accept/reject/refresh are org-member WRITES — accept opens a draft PR on a customer repo via the
// installation token (the practices/apply gating model), so it shares that route's error mapping.

import { NextResponse } from "next/server";
import { acceptDirection, isDbConfigured, listOpsState, refreshOps, rejectDirection } from "@/lib/db";
import { AppApiError } from "@/lib/github/app";
import { GitHubError } from "@/lib/github/source";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The ship loop requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const state = await listOpsState(org);
  if (!state) return NextResponse.json({ error: "Unknown org." }, { status: 404 });
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The ship loop requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; action?: string; id?: string };
  if (!body.org || !body.action) {
    return NextResponse.json({ error: "Provide { org, action }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  const actor = (isAuthConfigured() ? (await getSession())?.login : null) ?? null;

  try {
    if (body.action === "refresh") {
      const result = await refreshOps(body.org);
      if (!result) return NextResponse.json({ error: "Unknown org." }, { status: 404 });
      const state = await listOpsState(body.org);
      return NextResponse.json({ ...result, state });
    }
    if (body.action === "accept" || body.action === "reject") {
      if (!body.id) return NextResponse.json({ error: "Provide { id }." }, { status: 400 });
      if (body.action === "reject") {
        const ok = await rejectDirection(body.org, body.id, actor);
        if (!ok) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
        return NextResponse.json({ ok: true, state: await listOpsState(body.org) });
      }
      const result = await acceptDirection(body.org, body.id, actor);
      if (result.kind === "not-found") return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
      if (result.kind === "no-practice") {
        return NextResponse.json({ error: "No practice starter exists for this dimension yet." }, { status: 400 });
      }
      if (result.kind === "no-install") {
        return NextResponse.json(
          { error: "Ascent isn't installed on this repo's owner. Install the GitHub App (with write access) to open PRs." },
          { status: 403 },
        );
      }
      return NextResponse.json({ ok: true, item: result.item, reused: result.reused, state: await listOpsState(body.org) });
    }
    return NextResponse.json({ error: `Unknown action "${body.action}".` }, { status: 400 });
  } catch (err) {
    // Same GitHub-write error mapping as /api/practices/apply — the accept path shares its plumbing.
    if (err instanceof AppApiError) {
      const status = err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 502;
      const hint =
        err.status === 403
          ? "The installation lacks contents/PR write access — update the GitHub App's permissions."
          : err.status === 409
            ? "That file already exists in the repo — Ascent won't overwrite it with a starter."
            : "GitHub rejected the request. Check the repo and try again.";
      return NextResponse.json({ error: hint }, { status });
    }
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    console.error("[org/ops] failed", err);
    return NextResponse.json({ error: "Ship-loop action failed." }, { status: 500 });
  }
}
