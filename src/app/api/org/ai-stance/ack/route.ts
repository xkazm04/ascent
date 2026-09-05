// POST /api/org/ai-stance/ack { org, repo, version? }  ->  { ok, ack }
//
// Record that a repo acknowledged the org's AI stance (OrgArtifactAck — the repo ⇄ artifact-version
// primitive). Defaults to the ACTIVE published version; a caller may pin an explicit version only
// if it is a real one (≤ active). Admin-gated: acknowledging on a repo's behalf is a lighter write
// than restating the org-wide policy (owner), but it still changes what the governance readout
// claims about a repo, so it carries the same same-origin + role machinery and is audit-logged.

import { NextResponse } from "next/server";
import { ackOrgStance, getActiveOrgStance, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { requireSameOrigin } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { parseRepoUrl } from "@/lib/github/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Acknowledgements require a database." }, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string; repo?: string; version?: unknown };
  if (!body.org || !body.repo) {
    return NextResponse.json({ error: "Provide { org, repo }." }, { status: 400 });
  }
  const parsed = parseRepoUrl(body.repo);
  if (!parsed) return NextResponse.json({ error: "repo must be 'owner/name'." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "admin");
  if (denied) return denied;

  const active = await getActiveOrgStance(body.org);
  if (!active) {
    return NextResponse.json({ error: "No published stance to acknowledge." }, { status: 409 });
  }
  // Pin to a REAL version: default the active one; an explicit version must be 1..active (you can
  // acknowledge an older revision you actually adopted, never a version that doesn't exist yet).
  const version =
    typeof body.version === "number" && Number.isInteger(body.version) && body.version >= 1 && body.version <= active.version
      ? body.version
      : active.version;

  const actorLogin = await resolveViewerLogin();
  const ack = await ackOrgStance(body.org, `${parsed.owner}/${parsed.repo}`, version, actorLogin ?? null);
  if (ack === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  await recordOrgAudit(
    "org.ai_stance_ack",
    body.org,
    { org: body.org, repo: ack.repoFullName, version, status: `${ack.repoFullName} acknowledged v${version}` },
    actorLogin ?? undefined,
  ).catch(() => {});

  return NextResponse.json({ ok: true, ack });
}
