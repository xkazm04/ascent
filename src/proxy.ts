// Next.js 16 Proxy (formerly Middleware). Its sole job here is to keep the Supabase auth cookies
// fresh: on each request it reads the session, lets supabase-js re-mint an expiring token, and
// writes the refreshed cookies back onto the response. Without this, a user whose access token
// lapsed mid-session would be silently signed out on the next navigation.
//
// Cookie-free inbound APIs (GitHub/Polar webhooks, Vercel cron, anonymous badge) skip this — they
// have no session to refresh. Document navigations, including /org/*, still refresh.
//
// This must use the request/response cookie adapter (NOT next/headers), so it can't reuse
// src/lib/access.ts (server-only). It shares access.ts's PURE env predicates via @/lib/env (which is
// next/headers-free), so the bypass/configured rules have one definition: when Supabase isn't
// configured, or the dev bypass is on, there is nothing to refresh — pass through. gateInactive is
// exactly !authGateEnabled().

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authGateEnabled } from "@/lib/env";

// gateInactive is exactly !authGateEnabled(); the composed predicate lives in @/lib/env (shared with the
// server gate in access.ts) so this can't drift from the actual enforcement wall.
function gateInactive(): boolean {
  return !authGateEnabled();
}

// Cookie-free inbound paths: no browser session, so getUser() is wasted auth-server traffic
// (and used to be a 500 on every GitHub delivery if the auth server blipped). Prefix match so
// /api/cron/purge and /api/badge/owner/repo are covered. /org/* must never match.
const COOKIE_FREE_API_PREFIXES = [
  "/api/app/webhook",
  "/api/billing/webhook",
  "/api/badge",
  "/api/cron",
] as const;

/** True when this path has no Supabase session cookie to refresh. */
export function skipCookieRefresh(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return COOKIE_FREE_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  if (gateInactive()) return NextResponse.next({ request });
  if (skipCookieRefresh(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touch the session so an expiring token is refreshed and the new cookies ride `response`.
  // Do not gate routing here — authorization happens at the data sources (gate + Route Handlers).
  // This best-effort cookie refresh must NOT be request-fatal. The proxy still runs on a superset
  // of browser routes (document navigations and session-bearing APIs), so an un-guarded getUser()
  // would turn a transient Supabase auth-server hiccup into a 500 on the ENTIRE surface.
  // Mirror getViewer()'s tolerance (access.ts): treat a thrown/error result as "no user, cookie not
  // refreshed this request" and let the request proceed.
  try {
    await supabase.auth.getUser();
  } catch {
    // Transient auth-server failure — degrade to "cookie not refreshed", not a site-wide 500.
  }
  return response;
}

export const config = {
  // Run on everything except Next's static assets, common image files, and cookie-free inbound
  // APIs (webhooks, cron, badge). Keep the skip list in sync with skipCookieRefresh() — Next
  // requires this matcher to be a string literal, so it cannot be derived from the prefixes.
  // /org/* document navigations must keep matching so cookies still refresh there.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/app/webhook(?:/|$)|api/billing/webhook(?:/|$)|api/badge(?:/|$)|api/cron(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
