// LOCAL MODE pairing — Admin → Pairing's one endpoint (self-hosted deployments only).
//
//   POST { org, fullName, path }         → verify the path as a working copy of fullName, persist it
//   POST { org, fullName, path: null }   → unpair
//   POST { org, fullName, path, verifyOnly: true } → run the checks, persist NOTHING (the tab's
//                                          "Check" button — an operator wants the verdict before
//                                          committing a pairing, and a failed save that half-wrote
//                                          would be worse than either outcome)
//
// Guards, outermost first: self-host (404 on managed cloud — the surface doesn't exist there), DB,
// then OWNER role. Owner, not admin: a pairing points scans at arbitrary server-filesystem paths and
// is the prerequisite for the autopilot spawning a coding agent inside them — the same blast radius
// as the BYOM credential settings, which are owner-gated for the same reason.
//
// The filesystem probe (verifyLocalPath) runs only AFTER the role gate, so an unauthorized caller
// can never use this route to ask "does folder X exist on the server?" — the 403 answers first.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { verifyLocalPath } from "@/lib/local/pairing";
import { setRepoLocalPath } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("Local pairing", "Local pairing requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as {
    org?: unknown;
    fullName?: unknown;
    path?: unknown;
    verifyOnly?: unknown;
  };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const path = typeof body.path === "string" ? body.path.trim() : body.path === null ? null : undefined;
  if (!org || !fullName || path === undefined) {
    return NextResponse.json({ error: "Missing 'org', 'fullName' or 'path'." }, { status: 400 });
  }
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "The public funnel org cannot pair local paths." }, { status: 403 });
  }

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // Unpair: no filesystem involved, just clear the column.
  if (path === null) {
    const cleared = await setRepoLocalPath(org, fullName, null);
    if (!cleared) return NextResponse.json({ error: "Unknown repository for this organization." }, { status: 404 });
    return NextResponse.json({ ok: true, paired: false });
  }

  const check = await verifyLocalPath(path, fullName);
  if (body.verifyOnly === true) return NextResponse.json({ ok: check.ok, check });
  if (!check.ok) return NextResponse.json({ ok: false, check, error: check.error }, { status: 422 });

  const saved = await setRepoLocalPath(org, fullName, path);
  if (!saved) return NextResponse.json({ error: "Unknown repository for this organization." }, { status: 404 });
  return NextResponse.json({ ok: true, paired: true, check });
}
