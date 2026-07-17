// Supabase GitHub OAuth callback. signInWithOAuth() sends the user to GitHub, then GitHub →
// Supabase → here with a `?code=` (PKCE) and the `?next=` we asked to return to. We exchange the
// code for a session (which sets the auth cookies via the server client) and redirect onward.
//
// `next` is run through the existing safeNext() open-redirect guard (src/lib/auth.ts) so a tampered
// value can't bounce the user to an external origin — single-sourced with the custom-OAuth flow.
//
// ── DIVERGENCE from the dormant custom-OAuth callback (github-oauth-session 07-16 #3) ─────────────
// This is the callback that runs in PRODUCTION (the Supabase wall is the active auth stack; the
// custom GITHUB_OAUTH_* stack is unconfigured there). It does AUTHENTICATION ONLY: exchange the code,
// set cookies, redirect. The sign-in-moment PRODUCT behaviors live exclusively in the dormant custom
// callback (src/app/api/auth/callback/route.ts) and therefore DO NOT run for prod sign-ins:
//   - upsertInstallation (owner→installation linking; prod links only via webhook//api/app/setup)
//   - session revocation-version stamping (getSessionVersion)
//   - org auto-discovery + watchlist seeding (a brand-new prod user lands on an empty dashboard)
//   - first-login routing through the /launch cinematic (unreachable in prod, per the 07-09 audit)
//   - the resync=1 re-sync round-trip
// If any of those are wanted under the active wall, port them as a post-exchangeCodeForSession hook
// keyed on the Supabase identity's user_name — do not assume the custom callback's comments describe
// live behavior.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicOriginForRequest, safeNext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/");
  // The EXTERNAL origin (x-forwarded-proto/host aware), NOT url.origin: behind a TLS-terminating proxy
  // url.origin resolves to the INTERNAL http origin (e.g. http://10.0.0.5:3000), so a redirect built
  // from it would point the browser at an address it can't reach — sign-in "succeeds" but lands on a
  // connection error. Single-sourced with the cookie-Secure and redirect_uri decisions (the same helper).
  const origin = publicOriginForRequest(request);

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
    console.error("[auth/callback] code exchange failed", error.message);
  }

  // No code, or the exchange failed. This used to redirect to `/?auth_error=1` — a flag NO page or
  // component ever read, so every real-world sign-in failure (consent-screen cancel, expired code,
  // Supabase outage) was a silent dead-end back on the home page. Land on /connect instead, whose
  // error banner already renders these codes — the same taxonomy the custom-OAuth flow uses — and
  // distinguish a user-cancelled consent screen (`error=access_denied`, forwarded by Supabase/GitHub)
  // from a genuine exchange failure so a deliberate cancel isn't misreported as breakage.
  const denied = url.searchParams.get("error") === "access_denied";
  return NextResponse.redirect(new URL(`/connect?error=${denied ? "denied" : "oauth_failed"}`, origin));
}
