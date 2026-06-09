// GET /api/auth/callback — GitHub OAuth redirect. Verifies CSRF state, exchanges the
// code, loads the user + their App installations, sets the signed session cookie.

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
  RESYNC_COOKIE,
  safeNext,
  secureCookieForRequest,
  sessionMaxAgeSeconds,
  SESSION_COOKIE,
  STATE_COOKIE,
  type SessionDiscovery,
} from "@/lib/auth";
import { getSessionVersion, seedWatchlist, upsertInstallation } from "@/lib/db";
import {
  fetchUserOrgs,
  fetchUserRepos,
  rankDiscoveredOrgs,
  selectSeedTarget,
  selectSuggestedOrgLogins,
} from "@/lib/github/discover";

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
  const origin = url.origin;
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

    // Auto-discover the orgs the user belongs to (read:org) so a brand-new user doesn't land on a
    // blank dashboard: suggest which orgs to scan first in onboarding, and pre-seed the watchlist
    // for their most-active org so its rollup/trends fill in. Entirely best-effort — any failure
    // here (denied scope, rate limit, DB blip) must never block sign-in, so the whole block is
    // guarded and falls back to the installations-only session.
    const discovery = await discoverOrgs(token, user.login, installations.map((i) => i.login));

    const session = buildSession(user, installations, sv, discovery);
    // A re-sync lands back on the originating page with a confirmation flag, since the user
    // already passed through onboarding. A first sign-in lands on the cinematic "mission
    // control" fleet map rather than jumping straight to the next path; the intended
    // destination rides along as `next` so the entrance can hand off to it (its "Enter
    // mission control" affordance). `next` is already validated by safeNext above.
    const dest = resync
      ? `${next}${next.includes("?") ? "&" : "?"}resynced=1`
      : `/launch?next=${encodeURIComponent(next)}`;
    const res = NextResponse.redirect(new URL(dest, request.url));
    res.cookies.set(SESSION_COOKIE, encodeSession(session), {
      httpOnly: true,
      sameSite: "lax",
      // Derive Secure from the forwarded proto (matches the silent-refresh path), not the internal
      // request origin: behind a TLS-terminating proxy `url.origin` is the internal http origin, so
      // origin.startsWith("https") was false and the INITIAL session cookie was minted WITHOUT
      // Secure — letting it leak over plaintext. secureCookieForRequest reads x-forwarded-proto.
      secure: await secureCookieForRequest(),
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
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

/**
 * Best-effort org auto-discovery for a fresh session (see src/lib/github/discover.ts). Lists the
 * user's orgs + recently-pushed repos, ranks them by activity, then returns the not-yet-installed
 * orgs to suggest in onboarding and pre-seeds the watchlist for the most-active org. Every step is
 * defensively caught: a denied scope, a rate-limited listing, or a DB hiccup degrades to fewer (or
 * no) suggestions rather than failing the sign-in this runs inside.
 */
async function discoverOrgs(
  token: string,
  viewerLogin: string,
  installedLogins: string[],
): Promise<SessionDiscovery> {
  try {
    const installedSlugs = installedLogins.map((l) => l.toLowerCase());
    const [orgLogins, repos] = await Promise.all([
      fetchUserOrgs(token).catch(() => [] as string[]),
      fetchUserRepos(token).catch(() => []),
    ]);
    const ranked = rankDiscoveredOrgs({ orgLogins, repos, installedSlugs, viewerLogin });
    const suggestedOrgs = selectSuggestedOrgLogins(ranked);

    let seededOrg: string | undefined;
    const seed = selectSeedTarget(ranked);
    if (seed) {
      try {
        const seeded = await seedWatchlist(seed.slug, seed.repos);
        // Only point onboarding at the dashboard if seeding actually wrote (DB on + repos): a
        // zero means persistence is off, where the org view would just say "needs a database".
        if (seeded > 0) seededOrg = seed.slug;
      } catch (err) {
        console.warn(`[auth/callback] watchlist seed failed for ${seed.slug}`, err);
      }
    }
    return { suggestedOrgs, seededOrg };
  } catch (err) {
    console.warn("[auth/callback] org discovery failed; continuing without suggestions", err);
    return {};
  }
}
