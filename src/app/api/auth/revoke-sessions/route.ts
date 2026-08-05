// POST /api/auth/revoke-sessions — "sign out everywhere else". Revokes every OTHER session for the
// signed-in login (bumps the server-side session version, so other devices and any leaked cookie
// copy are rejected on their next resolve) while keeping THIS browser signed in (re-mints this
// cookie at the new version). The revocation primitive (bumpSessionVersion) already backed logout
// and uninstall; this gives the user a self-serve kill switch for a lost/shared machine.
//
// POST-only + same-origin, mirroring logout's CSRF guard: a safe GET with this side effect would
// let a third-party page force-revoke a victim's other sessions via an embedded <img>. Best-effort:
// with no DB there is no revocation authority, so we report that nothing was actually revoked.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, decodeSession, requireSameOrigin, revokeOtherSessions } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DUAL-STACK. This route used to read ONLY the dormant custom-OAuth cookie, so under the ACTIVE
 * Supabase wall — where `ascent_session` is never minted — it found no session and bounced to
 * /connect having revoked nothing. The user's self-serve kill switch for a lost or shared machine
 * did not exist in production, on the stack that IS production.
 *
 * Supabase's own primitive is `signOut({ scope: "others" })`: it revokes every OTHER refresh token
 * for this user server-side and deliberately leaves the CURRENT session's cookies alone — the same
 * contract revokeOtherSessions provides for the custom stack (bump the version, re-mint this browser
 * at the new one). So each stack keeps its own mechanism and the route just picks the live one.
 *
 * NOTE: the UI that reaches this route (`src/app/connect/page.tsx`) still renders its
 * "Sign out everywhere else" form only when the DORMANT `session` exists, so a production viewer
 * cannot yet click it. That file belongs to another context; the render gate is filed as a finding.
 */
export async function POST(request: Request) {
  // Canonical CSRF reject (G8-50) — same substitution as /api/auth/logout, and for the same reason:
  // the only caller is connect/page.tsx's plain `<form method="post">` navigation, which never reads
  // the 403 body (its success path is a 303 redirect). Body is now the shared
  // `{error:"Cross-origin request rejected."}`.
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  // ACTIVE stack first (mirroring resolveViewerLogin / the session route's precedence).
  if (authGateEnabled()) {
    if (!(await getViewer())) {
      return NextResponse.redirect(new URL("/connect", request.url), 303);
    }
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw new Error(error.message);
      return NextResponse.redirect(new URL("/connect?revoked=others", request.url), 303);
    } catch (err) {
      // Report the failure rather than redirecting as though it worked: on a shared machine,
      // "we revoked your other sessions" when we did not is the worst possible answer.
      console.warn("[auth/revoke-sessions] supabase revoke failed", err instanceof Error ? err.message : err);
      return NextResponse.redirect(new URL("/connect?error=revoke", request.url), 303);
    }
  }

  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = raw ? decodeSession(raw) : null;
  // No valid session → nothing to revoke; bounce back to connect (303 so the form POST follows with GET).
  if (!session) {
    return NextResponse.redirect(new URL("/connect", request.url), 303);
  }
  try {
    const revoked = await revokeOtherSessions(session);
    return NextResponse.redirect(
      new URL(`/connect?revoked=${revoked ? "others" : "none"}`, request.url),
      303,
    );
  } catch (err) {
    console.warn("[auth/revoke-sessions] failed", err);
    return NextResponse.redirect(new URL("/connect?error=revoke", request.url), 303);
  }
}
