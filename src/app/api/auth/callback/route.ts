// GET /api/auth/callback — GitHub OAuth redirect. Verifies CSRF state, exchanges the
// code, loads the user + their App installations, sets the signed session cookie.
//
// ── DIVERGENCE (github-oauth-session 07-16 #3): this is the DORMANT custom-OAuth stack ────────────
// In production the ACTIVE sign-in path is the Supabase wall (src/app/auth/callback/route.ts);
// `.env.production` carries no GITHUB_OAUTH_*/AUTH_SECRET, so isAuthConfigured() is false and THIS
// route never runs there. Everything below — installation upsert, session-version stamping, org
// auto-discovery, watchlist seeding, the /launch first-login cinematic, resync=1 — executes ONLY
// when the custom stack is configured (local/self-hosted). Do not read these comments as the
// product's live sign-in behavior; the Supabase callback runs none of it (its header lists the gap).

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import {
  buildSession,
  encodeSession,
  exchangeCodeForToken,
  fetchGithubUser,
  fetchUserInstallations,
  isAuthConfigured,
  NEXT_COOKIE,
  publicOriginForRequest,
  RESYNC_COOKIE,
  safeNext,
  secureCookieForRequest,
  sessionCookieAttrs,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "@/lib/auth";
import { getSessionVersion, upsertInstallation } from "@/lib/db";
import { discoverOrgsForLogin } from "@/lib/auth-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time string equality. Hashing both sides to a fixed 32 bytes first keeps the comparison
 *  constant-time regardless of input length, so the CSRF state check can't leak the saved value via
 *  timing — mirroring the session HMAC's own timingSafeEqual check. */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // The EXTERNAL origin (x-forwarded-proto/host aware), NOT url.origin: the token exchange's
  // redirect_uri must be byte-identical to the one the authorize request sent, and the login
  // route builds that from the same helper — behind a TLS-terminating proxy url.origin is the
  // internal http origin and the exchange would be rejected with a redirect_uri mismatch.
  const origin = publicOriginForRequest(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // GitHub redirected back with an explicit error — the user cancelled on the consent screen, the
  // authorization expired, or the App was suspended. This arrives WITH a valid state cookie and no
  // code, so it must be handled before the CSRF/missing-code guard below, or it would be misreported
  // as a generic "oauth" failure indistinguishable from a forged-state attack (and the user would get
  // no "you cancelled — try again" guidance). Surface a distinct, actionable code and log the reason.
  if (oauthError) {
    console.warn(
      `[auth/callback] GitHub OAuth error: ${oauthError}`,
      url.searchParams.get("error_description") ?? "",
    );
    const res = NextResponse.redirect(new URL("/connect?error=denied", request.url));
    res.cookies.delete(RESYNC_COOKIE);
    return res;
  }

  const store = await cookies();
  const savedState = store.get(STATE_COOKIE)?.value;
  const next = safeNext(store.get(NEXT_COOKIE)?.value);
  const resync = store.get(RESYNC_COOKIE)?.value === "1";

  if (!isAuthConfigured() || !code || !state || !savedState) {
    return NextResponse.redirect(new URL("/connect?error=oauth", request.url));
  }
  // Constant-time CSRF state comparison (not a plain `!==`), kept as its own branch so a genuine
  // mismatch surfaces a distinct `error=csrf` for logs/incident response rather than the generic code.
  if (!constantTimeEqual(state, savedState)) {
    console.warn("[auth/callback] CSRF state mismatch");
    return NextResponse.redirect(new URL("/connect?error=csrf", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, origin);
    const user = await fetchGithubUser(token);
    const installations = await fetchUserInstallations(token);
    // Link installations to orgs so owner->installation resolution works for scans.
    for (const i of installations) {
      try {
        await upsertInstallation({ login: i.login, installationId: i.id });
      } catch {
        /* DB optional */
      }
    }
    // Stamp the session with the login's current revocation version so it stays valid until
    // the next bump (logout / access change). A missing row reads as version 0; best-effort,
    // so a DB hiccup at login falls back to the stateless version-0 behavior.
    let sv = 0;
    try {
      sv = await getSessionVersion(user.login);
    } catch {
      /* DB optional */
    }

    // Auto-discover the orgs the user belongs to so a brand-new user doesn't land on a blank
    // dashboard: suggest which orgs to scan first in onboarding, and pre-seed the watchlist for
    // their most-active org so its rollup/trends fill in. The default scope is read:user only
    // (least-privilege consent — see buildAuthorizeUrl), so /user/orgs lists just PUBLIC org
    // memberships; a token carrying read:org (an earlier broader grant) yields full discovery.
    // Entirely best-effort — any failure here (denied scope, rate limit, DB blip) must never
    // block sign-in, so the whole block is guarded and falls back to the installations-only session.
    const discovery = await discoverOrgsForLogin(token, user.login, installations.map((i) => i.login));

    const session = buildSession(user, installations, sv, discovery);
    // A re-sync lands back on the originating page with a confirmation flag, since the user
    // already passed through onboarding. A first sign-in lands on the cinematic "mission
    // control" fleet map rather than jumping straight to the next path; the intended
    // destination rides along as `next` so the entrance can hand off to it (its "Enter
    // mission control" affordance). `next` is already validated by safeNext above.
    let dest: string;
    if (resync) {
      // Build via URL so `resynced=1` lands as a real query param regardless of an existing query or a
      // #fragment in `next` (safeNext preserves fragments). The old string concat produced
      // "/path#frag?resynced=1" (the param swallowed into the fragment, never seen by the page) or
      // appended after the fragment — so the post-resync confirmation silently never showed.
      const u = new URL(next, request.url);
      u.searchParams.set("resynced", "1");
      dest = u.pathname + u.search + u.hash;
    } else {
      dest = `/launch?next=${encodeURIComponent(next)}`;
    }
    const res = NextResponse.redirect(new URL(dest, request.url));
    // Derive Secure from the forwarded proto (matches the silent-refresh path), not the internal
    // request origin: behind a TLS-terminating proxy `url.origin` is the internal http origin, so
    // origin.startsWith("https") was false and the INITIAL session cookie was minted WITHOUT
    // Secure — letting it leak over plaintext. secureCookieForRequest reads x-forwarded-proto.
    // sessionCookieAttrs is the shared attribute set (httpOnly/sameSite/path/maxAge) — same shape
    // the silent-refresh re-mint and revokeOtherSessions use, so the initial cookie can't drift.
    res.cookies.set(SESSION_COOKIE, encodeSession(session), sessionCookieAttrs(await secureCookieForRequest()));
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(NEXT_COOKIE);
    res.cookies.delete(RESYNC_COOKIE);
    return res;
  } catch (err) {
    console.error("[auth/callback] failed", err);
    const res = NextResponse.redirect(new URL("/connect?error=oauth_failed", request.url));
    res.cookies.delete(RESYNC_COOKIE);
    return res;
  }
}
