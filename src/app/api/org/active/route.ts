// POST /api/org/active  { org }  — remember the viewer's active org in a cookie so the
// whole app (header switcher, /usage, /org) follows their chosen tenant context across visits.
//
// Same-origin + POST-only, mirroring /api/auth/logout: a safe-method GET with a side effect
// could be triggered cross-site. The requested org is re-validated against the session's
// installations (plus "public"), so the persisted value can only ever be one the viewer can read.

import { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE, PUBLIC_ORG, isSameOrigin, sessionMaxAgeSeconds } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  const requested = (body.org ?? "").trim();
  if (!requested) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });

  // Only honor an org the viewer can actually read — never trust the client's string. This used to
  // validate against `orgOptionsForSession(getSession())`, which reads the DORMANT custom-OAuth session:
  // under the ACTIVE Supabase wall that session is null, so the list collapsed to just ["public"] and
  // EVERY real org switch was rejected with "Unknown org" — the org switcher was dead in production.
  // canReadOrg is the active-path read gate (membership under the Supabase wall; PUBLIC_ORG always
  // readable), so it accepts exactly the orgs the viewer may select. Slugs are stored lowercased.
  const slug = requested.toLowerCase();
  if (!(await canReadOrg(slug))) {
    return NextResponse.json({ error: "Unknown org." }, { status: 400 });
  }
  const match = slug === PUBLIC_ORG.toLowerCase() ? PUBLIC_ORG : slug;

  const res = NextResponse.json({ org: match });
  res.cookies.set(ACTIVE_ORG_COOKIE, match, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
  return res;
}
