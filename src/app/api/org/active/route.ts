// POST /api/org/active  { org }  — remember the viewer's active org in a cookie so the
// whole app (header switcher, /usage, /org) follows their chosen tenant context across visits.
//
// Same-origin + POST-only, mirroring /api/auth/logout: a safe-method GET with a side effect
// could be triggered cross-site. The requested org is re-validated against the session's
// installations (plus "public"), so the persisted value can only ever be one the viewer can read.

import { NextResponse } from "next/server";
import {
  ACTIVE_ORG_COOKIE,
  getSession,
  isSameOrigin,
  orgOptionsForSession,
  sessionMaxAgeSeconds,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  const requested = (body.org ?? "").trim();
  if (!requested) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });

  // Only honor an org the viewer can actually select — never trust the client's string.
  const match = orgOptionsForSession(await getSession()).find(
    (o) => o.toLowerCase() === requested.toLowerCase(),
  );
  if (!match) return NextResponse.json({ error: "Unknown org." }, { status: 400 });

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
