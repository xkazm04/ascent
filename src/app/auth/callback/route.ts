// Supabase GitHub OAuth callback. signInWithOAuth() sends the user to GitHub, then GitHub →
// Supabase → here with a `?code=` (PKCE) and the `?next=` we asked to return to. We exchange the
// code for a session (which sets the auth cookies via the server client) and redirect onward.
//
// `next` is run through the existing safeNext() open-redirect guard (src/lib/auth.ts) so a tampered
// value can't bounce the user to an external origin — single-sourced with the custom-OAuth flow.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), "/");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("[auth/callback] code exchange failed", error.message);
  }

  // No code, or the exchange failed — send the user home with a flag the UI can surface.
  return NextResponse.redirect(new URL("/?auth_error=1", url.origin));
}
