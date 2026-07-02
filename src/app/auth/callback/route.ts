// Supabase GitHub OAuth callback. signInWithOAuth() sends the user to GitHub, then GitHub →
// Supabase → here with a `?code=` (PKCE) and the `?next=` we asked to return to. We exchange the
// code for a session (which sets the auth cookies via the server client) and redirect onward.
//
// `next` is run through the existing safeNext() open-redirect guard (src/lib/auth.ts) so a tampered
// value can't bounce the user to an external origin — single-sourced with the custom-OAuth flow.

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

  // No code, or the exchange failed — send the user home with a flag the UI can surface.
  return NextResponse.redirect(new URL("/?auth_error=1", origin));
}
