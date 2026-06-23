// Next.js 16 Proxy (formerly Middleware). Its sole job here is to keep the Supabase auth cookies
// fresh: on each request it reads the session, lets supabase-js re-mint an expiring token, and
// writes the refreshed cookies back onto the response. Without this, a user whose access token
// lapsed mid-session would be silently signed out on the next navigation.
//
// This must use the request/response cookie adapter (NOT next/headers), so it can't reuse
// src/lib/access.ts (server-only). The env checks are inlined to match authGateEnabled():
// when Supabase isn't configured, or the dev bypass is on, there is nothing to refresh — pass through.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { envBool } from "@/lib/env";

function gateInactive(): boolean {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  // Mirror authBypassEnabled(): the dev bypass is hard-disabled in production so a stray env var can't
  // turn the wall off. (Here it only governs cookie refresh, but keep the two checks consistent.)
  const bypass = process.env.NODE_ENV !== "production" && envBool("ASCENT_AUTH_BYPASS");
  return !configured || bypass;
}

export async function proxy(request: NextRequest) {
  if (gateInactive()) return NextResponse.next({ request });

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
  // This best-effort cookie refresh must NOT be request-fatal. The proxy runs on a superset of
  // requests (the broad matcher below, incl. unauthenticated/public paths), so an un-guarded
  // getUser() would turn a transient Supabase auth-server hiccup into a 500 on the ENTIRE surface.
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
  // Run on everything except Next's static assets and common image files — auth cookies should be
  // refreshed on real navigations and API calls, not on static fetches.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
