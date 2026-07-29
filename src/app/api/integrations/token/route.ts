// POST /api/integrations/token { org, rotate: true } -> { token, epoch }
//
// Regenerate an org's OTel ingest token. The token is the whole auth story for the public ingest
// endpoint, and it is designed to be COPIED — into a shell profile, a CI secret, a Slack thread by
// mistake. Before this route the only remedy for a leaked token was rotating the server-wide
// INTEGRATIONS_INGEST_SECRET, which silently re-derives every OTHER org's token at the same time.
// Bumping the per-org epoch (Organization.ingestTokenEpoch — the same version-bump revocation shape
// SessionRevocation uses for sessions) invalidates ONLY this org's outstanding tokens, on the very
// next ingest request.
//
// Owner-only: the response body IS the new credential, so read access to it must be as tight as the
// Integrations page that renders it. Same-origin enforced (CSRF defense-in-depth, the session cookie
// is SameSite=Lax) and the rotation is audited — it stops a running exporter, so "who did this and
// when" has to be answerable.

import { NextResponse } from "next/server";
import { bumpIngestTokenEpoch, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { ingestToken } from "@/lib/integrations/ingest-token";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const body = (await request.json().catch(() => ({}))) as { org?: string; rotate?: unknown };
  const org = (body.org ?? "").trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Provide { org, rotate: true }." }, { status: 400 });
  // An explicit intent flag, so a stray POST can't revoke a fleet's telemetry by accident.
  if (body.rotate !== true) return NextResponse.json({ error: "Set { rotate: true } to confirm regeneration." }, { status: 400 });

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  if (!isDbConfigured()) {
    // Without persistence there is nowhere to record the bump, so the old token would keep working —
    // report that instead of returning a "new" token that revokes nothing.
    return NextResponse.json({ error: "Regenerating the ingest token requires a database." }, { status: 503 });
  }

  const epoch = await bumpIngestTokenEpoch(org);
  if (epoch === null) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  const actor = await resolveViewerLogin();
  await recordOrgAudit("integrations.token.rotate", org, { epoch }, actor ?? undefined);

  return NextResponse.json({ token: ingestToken(org, epoch), epoch });
}
