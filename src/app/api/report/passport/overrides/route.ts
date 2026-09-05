// POST  /api/report/passport/overrides { repo, criticality?, lifecycle?, rollback?, declined? } -> { ok }
//   Replace the whole overrides blob for a repo (empty clears it).
// PATCH /api/report/passport/overrides { repo, declined: { "<field.path>": { reason? } | null } } -> { ok }
//   Merge declined-by-choice entries keyed by field path; `null` retracts one. Everything else is kept.
//
// These are the owner-supplied passport facts a scan can't observe (P4) plus the 0.2.0 "declined by
// choice" decisions ("no error tracking — deliberate, this is an internal cron worker"). Applied as a
// read-time overlay, so the change shows immediately (no re-scan) on the report card + the fleet
// portfolio, and — because it is stored beside the scan rather than inside it — a re-scan can never clear
// it. Owner-gated + same-origin; rejected for the public funnel (overrides are an org-owned-repo concern).

import { NextResponse } from "next/server";
import { isDbConfigured, mergePassportDeclines, recordOrgAudit, setPassportOverrides } from "@/lib/db";
import { PUBLIC_ORG, requireSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { isDeclinablePath, parseDeclined, type DeclineEntry, type PassportOverrides } from "@/lib/analyze/passport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepo(q: string): { owner: string; name: string } | null {
  const slash = q.indexOf("/");
  if (slash <= 0 || slash === q.length - 1 || q.indexOf("/", slash + 1) >= 0) return null;
  return { owner: q.slice(0, slash), name: q.slice(slash + 1) };
}

/** Shared preamble for both writers: same-origin, a parseable repo, an org-owned repo, owner role. */
async function gate(request: Request, body: { repo?: string }): Promise<{ orgSlug: string; fullName: string } | Response> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Passport overrides require a database." }, { status: 503 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const parsed = body.repo ? parseRepo(body.repo) : null;
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });

  const orgSlug = await readableOrgForOwner(parsed.owner);
  if (orgSlug === PUBLIC_ORG) {
    return NextResponse.json({ error: "Passport overrides are only for org-owned repositories." }, { status: 403 });
  }
  const denied = await requireOrgRole(orgSlug, "owner");
  if (denied) return denied;
  return { orgSlug, fullName: `${parsed.owner}/${parsed.name}` };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    criticality?: PassportOverrides["criticality"];
    lifecycle?: PassportOverrides["lifecycle"];
    rollback?: boolean;
    declined?: Record<string, { reason?: string; at?: string }>;
  };
  const ctx = await gate(request, body);
  if (ctx instanceof Response) return ctx;

  // Validate the declined map against the allow-list BEFORE writing: an unknown field path is a client
  // bug, not something to silently drop, so it is a 400 rather than a partial write.
  if (body.declined !== undefined) {
    if (typeof body.declined !== "object" || body.declined === null || Array.isArray(body.declined)) {
      return NextResponse.json({ error: "`declined` must be an object keyed by passport field path." }, { status: 400 });
    }
    const unknown = Object.keys(body.declined).filter((p) => !isDeclinablePath(p));
    if (unknown.length) return NextResponse.json({ error: `Not a declinable passport field: ${unknown.join(", ")}` }, { status: 400 });
  }

  const declined = parseDeclined(body.declined);
  const ok = await setPassportOverrides(ctx.orgSlug, ctx.fullName, {
    criticality: body.criticality,
    lifecycle: body.lifecycle,
    rollback: body.rollback,
    ...(declined ? { declined } : {}),
  });
  if (!ok) return NextResponse.json({ error: "Unknown repository (scan it first)." }, { status: 404 });

  // resolveViewerLogin: the dormant custom-OAuth session is null under the ACTIVE Supabase wall,
  // so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "passport.overrides_set",
    ctx.orgSlug,
    {
      repo: ctx.fullName,
      criticality: body.criticality ?? null,
      lifecycle: body.lifecycle ?? null,
      rollback: body.rollback ?? null,
      declined: declined ? Object.keys(declined) : null,
    },
    actorLogin ?? undefined,
  );
  return NextResponse.json({ ok: true });
}

/** Merge/retract declined-by-choice entries without disturbing the rest of the overrides blob. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    declined?: Record<string, { reason?: string; at?: string } | null>;
  };
  const ctx = await gate(request, body);
  if (ctx instanceof Response) return ctx;

  const raw = body.declined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return NextResponse.json({ error: "Provide { declined: { '<field.path>': { reason? } | null } }." }, { status: 400 });
  }
  const unknown = Object.keys(raw).filter((p) => !isDeclinablePath(p));
  if (unknown.length) return NextResponse.json({ error: `Not a declinable passport field: ${unknown.join(", ")}` }, { status: 400 });

  // Sanitize the set-values through the shared validator (trims/caps reason, drops bad dates); nulls pass
  // through as explicit retractions.
  const sanitized = parseDeclined(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null))) ?? {};
  const changes: Record<string, DeclineEntry | null> = {};
  for (const [path, v] of Object.entries(raw)) changes[path] = v === null ? null : (sanitized[path] ?? {});

  const ok = await mergePassportDeclines(ctx.orgSlug, ctx.fullName, changes);
  if (!ok) return NextResponse.json({ error: "Unknown repository (scan it first)." }, { status: 404 });

  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "passport.declines_set",
    ctx.orgSlug,
    {
      repo: ctx.fullName,
      declined: Object.entries(changes).filter(([, v]) => v !== null).map(([p]) => p),
      retracted: Object.entries(changes).filter(([, v]) => v === null).map(([p]) => p),
    },
    actorLogin ?? undefined,
  );
  return NextResponse.json({ ok: true });
}
