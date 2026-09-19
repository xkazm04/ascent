// GET /api/auth/session — lightweight JSON session status for client components, the CLI
// integrations, and "your session expires in N minutes" nudges. Everything here is already
// computed on every server render; this just surfaces it to the browser, which previously had no
// way to ask "am I still signed in / who am I / when does this expire" without scraping a
// server-rendered page.
//
// DUAL-STACK (github-oauth-session 07-16 #1): this endpoint used to answer ONLY for the dormant
// custom GitHub OAuth (`getSessionState()`), whose first check is `isAuthConfigured()` — false in
// the documented prod config — so it unconditionally reported a signed-in Supabase user as
// signed out. It now mirrors resolveViewerLogin()'s precedence: when the ACTIVE Supabase login
// wall is enforced (`authGateEnabled()`), the Supabase viewer is the identity reported; otherwise
// it falls through to the custom-OAuth session state. Under the Supabase wall, `installations`
// is the viewer's GitHub App installation logins (so /launch can list orgs without a second
// round trip) and `expiresAt` is null (Supabase refreshes its own tokens; there is no fixed
// inactivity horizon to nudge about). An unauthenticated caller never receives installations.
//
// Only non-sensitive fields are returned: the login, display name/avatar, the installation
// LOGINS (not their numeric ids), the status, and the absolute expiry. No token is ever in the
// payload. On the custom stack, resolving the state runs the silent-refresh path, so a periodic
// client poll also slides the inactivity horizon forward for a genuinely-active user.

import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { viewerInstallations } from "@/lib/viewer-installations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };

const SIGNED_OUT = { status: "none", login: null, name: null, image: null, installations: [] as string[], expiresAt: null };

export async function GET() {
  if (authGateEnabled()) {
    // ACTIVE stack: the Supabase login wall. getViewer() validates the JWT against the auth server.
    const viewer = await getViewer();
    if (!viewer) {
      // Do not resolve installations for a signed-out caller — a stale custom-OAuth cookie must
      // not leak another identity's org list onto a payload that claims status "none".
      return NextResponse.json(SIGNED_OUT, { headers: NO_STORE });
    }
    // viewerInstallations is the dual-stack resolver /launch already uses. Logins only, matching
    // the custom-OAuth payload; a lookup failure must not 500 the session-status poll.
    const installations = (await viewerInstallations().catch(() => [])).map((i) => i.login);
    const body = {
      status: "active",
      login: viewer.login,
      name: viewer.name ?? null,
      image: viewer.avatar ?? null,
      installations,
      expiresAt: null,
    };
    // Never let a shared cache hold one viewer's session status and serve it to another.
    return NextResponse.json(body, { headers: NO_STORE });
  }

  // Dormant/self-hosted custom GitHub OAuth (only reachable when the Supabase gate is off).
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
  return NextResponse.json(body, { headers: NO_STORE });
}
