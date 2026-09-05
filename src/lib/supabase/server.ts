// Server-side Supabase client bound to the request's cookies (next/headers). Used by the
// access gate (src/lib/access.ts), the OAuth callback, and any Route Handler / Server
// Component that needs the signed-in user. The proxy (src/proxy.ts) refreshes the auth
// cookies on each request; here we read them and let supabase-js re-mint when it can.
//
// setAll is wrapped in try/catch because a Server Component render has a read-only cookie
// store — the write throws there and is safely ignored (the proxy will have refreshed the
// cookie on the same request), exactly mirroring the tolerance in getSessionState().

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Read-only cookie store (Server Component render) — ignore; the proxy refreshes it.
          }
        },
      },
    },
  );
}
