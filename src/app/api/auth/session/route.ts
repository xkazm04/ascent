// GET /api/auth/session — lightweight JSON session status for client components, the badge/CLI
// integrations, and "your session expires in N minutes" nudges. Everything here is already
// computed by getSessionState() on every server render; this just surfaces it to the browser,
// which previously had no way to ask "am I still signed in / who am I / when does this expire"
// without scraping a server-rendered page.
//
// Only non-sensitive fields are returned: the login, display name/avatar, the installation
// LOGINS (not their numeric ids), the status, and the absolute expiry. The GitHub token is never
// in the session to begin with. Resolving the state runs the silent-refresh path, so a periodic
// client poll also slides the inactivity horizon forward for a genuinely-active user.

import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { session, status, expiresAt } = await getSessionState();
  const body = session
    ? {
        status, // "active"
        login: session.login,
        name: session.name ?? null,
        image: session.image ?? null,
        installations: session.installations.map((i) => i.login),
        expiresAt: expiresAt ?? null,
      }
    : { status, login: null, name: null, image: null, installations: [], expiresAt: null };
  // Never let a shared cache hold one viewer's session status and serve it to another.
  return NextResponse.json(body, { headers: { "cache-control": "no-store, private" } });
}
