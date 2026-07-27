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
//   - the resync=1 re-sync round-trip
// (Sign-in routing through /launch is NO LONGER part of that gap — see POST-SIGN-IN DESTINATION.)
// If any of those are wanted under the active wall, port them as a post-exchangeCodeForSession hook
// keyed on the Supabase identity's user_name — do not assume the custom callback's comments describe
// live behavior.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicOriginForRequest, safeNext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where a successful sign-in lands when the flow carried no destination of its own. */
const DEFAULT_SIGNED_IN_DEST = "/launch";

/**
 * Resolve the post-sign-in destination.
 *
 * ── POST-SIGN-IN DESTINATION (launch-fleet-map, 07-27) ────────────────────────────────────────────
 * An EXPLICIT `?next=` always wins: every flow that has somewhere to be (the onboarding wizard's
 * resume round-trip to /onboarding, /connect, a deep-linked report, the /launch sign-in prompt
 * itself) sets it on the `redirectTo` it hands signInWithOAuth, and hijacking that would strand the
 * user mid-flow. Only a sign-in with NO destination of its own is re-pointed.
 *
 * That "no destination" case used to fall back to `/` — the MARKETING home page — which is how
 * /launch (the product's cinematic mission-control entrance, built for exactly this moment) ended up
 * unreachable in production: the dormant custom-OAuth callback routed first sign-ins there
 * (src/app/api/auth/callback/route.ts), but that stack never runs under the Supabase wall, and
 * nothing else in the app links to /launch.
 *
 * FIRST-RUN vs RETURNING: the dormant stack never actually detected a first run either — it split on
 * its own RESYNC_COOKIE (an explicit "I'm only re-syncing my installations" round-trip) and sent
 * EVERY other sign-in to /launch. Supabase's callback has no equivalent cheap, trustworthy signal:
 * `exchangeCodeForSession` hands back a user whose `created_at`/`last_sign_in_at` are Supabase-clock
 * timestamps we'd have to threshold against our own clock, and the identity row survives an App
 * uninstall — so a "first run" flag derived from it would be both skew-sensitive and wrong for the
 * user who returns after removing the App. So we mirror the dormant stack's ACTUAL rule instead of
 * inventing a fragile one: no explicit destination → /launch, first-run or not. That stays sane for
 * returning users because /launch itself redirects to /connect when the viewer has no installations
 * (src/app/launch/page.tsx), so the only people who ever see the map are people who have a fleet to
 * see — and the map's own "Enter mission control" affordance carries them onward.
 *
 * A tampered/external `next` is neutralized by safeNext (open-redirect guard) to the `/` fallback,
 * which lands here as "no destination" and therefore goes to /launch, never off-origin.
 *
 * Module-PRIVATE on purpose: a `route.ts` may only export HTTP handlers + route config (no other
 * file under src/app exports a helper from a route module), so the branching is pinned through GET.
 */
function signedInDestination(rawNext: string | null): string {
  const next = safeNext(rawNext, "/");
  return next === "/" ? DEFAULT_SIGNED_IN_DEST : next;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = signedInDestination(url.searchParams.get("next"));
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
