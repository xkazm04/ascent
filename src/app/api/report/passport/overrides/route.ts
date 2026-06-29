// POST /api/report/passport/overrides { repo, criticality?, lifecycle?, rollback? }  ->  { ok }
// Set the owner-supplied passport fields a scan can't observe (P4). Applied as a read-time overlay, so
// the change shows immediately (no re-scan) on the report card + the fleet portfolio. Owner-gated +
// same-origin; rejected for the public funnel (overrides are an org-owned-repo concern). Empty clears.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit, setPassportOverrides } from "@/lib/db";
import { PUBLIC_ORG, getSession, isSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import type { PassportOverrides } from "@/lib/analyze/passport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepo(q: string): { owner: string; name: string } | null {
  const slash = q.indexOf("/");
  if (slash <= 0 || slash === q.length - 1 || q.indexOf("/", slash + 1) >= 0) return null;
  return { owner: q.slice(0, slash), name: q.slice(slash + 1) };
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Passport overrides require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    criticality?: PassportOverrides["criticality"];
    lifecycle?: PassportOverrides["lifecycle"];
    rollback?: boolean;
  };
  const parsed = body.repo ? parseRepo(body.repo) : null;
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });

  const orgSlug = await readableOrgForOwner(parsed.owner);
  if (orgSlug === PUBLIC_ORG) {
    return NextResponse.json({ error: "Passport overrides are only for org-owned repositories." }, { status: 403 });
  }
  const denied = await requireOrgRole(orgSlug, "owner");
  if (denied) return denied;

  const fullName = `${parsed.owner}/${parsed.name}`;
  const ok = await setPassportOverrides(orgSlug, fullName, {
    criticality: body.criticality,
    lifecycle: body.lifecycle,
    rollback: body.rollback,
  });
  if (!ok) return NextResponse.json({ error: "Unknown repository (scan it first)." }, { status: 404 });

  const session = await getSession();
  await recordOrgAudit(
    "passport.overrides_set",
    orgSlug,
    { repo: fullName, criticality: body.criticality ?? null, lifecycle: body.lifecycle ?? null, rollback: body.rollback ?? null },
    session?.login,
  );
  return NextResponse.json({ ok: true });
}
