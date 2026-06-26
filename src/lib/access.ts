// The single access gate the rest of the app consults for "is there a signed-in viewer?".
// Layered ON TOP of the dormant custom GitHub OAuth (src/lib/auth.ts): when Supabase auth is
// configured, this is the active login wall; when it isn't (or the dev-bypass flag is set), the
// gate is OPEN and the app behaves exactly as it did before — preserving the auth-off local/demo
// and org-e2e workflows.
//
// Server-only module (reads cookies via the Supabase server client); never import from a client
// component — mirrors the convention in src/lib/auth.ts.

import { cache } from "react";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
// The pure env predicates live in @/lib/env so the next/headers-free proxy (src/proxy.ts) can share
// the SAME definitions instead of re-implementing the bypass/configured/gate logic. Re-exported here so
// the gate's public surface (authBypassEnabled/supabaseAuthConfigured/authGateEnabled) is unchanged for
// existing importers.
import { authBypassEnabled, authGateEnabled, supabaseAuthConfigured } from "@/lib/env";

export { authBypassEnabled, authGateEnabled, supabaseAuthConfigured };

/** Non-sensitive identity of the signed-in viewer (GitHub login + profile bits for the header). */
export interface Viewer {
  id: string;
  login: string;
  email?: string;
  avatar?: string;
  name?: string;
}

const DEV_VIEWER: Viewer = {
  id: "dev",
  login: "developer",
  email: "dev@localhost",
  name: "Developer",
};

/**
 * The current signed-in viewer, or null. Returns the synthetic DEV_VIEWER when the bypass flag is
 * on (so the header still shows "Developer" and every gate passes). Otherwise resolves the Supabase
 * user — getUser() validates the JWT against the auth server, so the result is trustworthy.
 * Memoized per render pass with React cache() to avoid re-validating on every gate check.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (authBypassEnabled()) return DEV_VIEWER;
  if (!supabaseAuthConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return null;
    const meta = (u.user_metadata ?? {}) as Record<string, string | undefined>;
    return {
      id: u.id,
      login: meta.user_name ?? meta.preferred_username ?? u.email ?? u.id,
      email: u.email ?? undefined,
      avatar: meta.avatar_url,
      name: meta.full_name ?? meta.name,
    };
  } catch {
    // A transient auth-server hiccup shouldn't hard-crash a render/handler — treat as signed-out.
    return null;
  }
});

/**
 * API-route gate, the Supabase sibling of requireOrgAccess: returns a 401 NextResponse when the
 * login wall is enforced and there is no viewer, or null when the request may proceed. No-op (null)
 * when the gate is disabled (Supabase unconfigured / bypass on), so existing open behavior is kept.
 */
export async function requireViewer(): Promise<NextResponse | null> {
  if (!authGateEnabled()) return null;
  if (await getViewer()) return null;
  return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
}
