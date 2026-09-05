// Browser-side Supabase client (used by the sign-in / sign-out buttons). Reads the public
// project URL + anon key — both are safe to ship to the client: the anon key is public by
// design and Row-Level Security on the Supabase project is what actually protects data.
// Server code must use createSupabaseServerClient() from ./server instead.

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
