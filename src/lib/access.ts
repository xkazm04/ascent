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
    // ONLY surface an address Supabase reports as CONFIRMED (`email_confirmed_at`). `user.email` is
    // populated the moment an account is registered — verified or not — so passing it through made
    // "the viewer's VERIFIED email" a promise nothing checked: anyone could register an UNCONFIRMED
    // victim@example.com account and satisfy an email-pinned org invite meant for the victim
    // (src/lib/db/invites.ts acceptInvite). Omitting the field for an unconfirmed address makes that
    // binding fail closed (`wrong_email`) and keeps the scan completion email from being sent to an
    // address the account holder never proved they own. GitHub OAuth sign-ins (the production path)
    // arrive already confirmed, so legitimate viewers are unaffected.
    const email = u.email_confirmed_at ? (u.email ?? undefined) : undefined;
    return {
      id: u.id,
      // `login` keeps its raw-email fallback: it is a DISPLAY/attribution key (never an ownership
      // proof for an email pin), and changing it for unconfirmed accounts would silently re-key
      // login-scoped data (e.g. Shared Org Memory's private filter) mid-session.
      login: meta.user_name ?? meta.preferred_username ?? u.email ?? u.id,
      email,
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

/**
 * The login of whoever is making this request, across BOTH auth stacks: the custom-OAuth session wins,
 * then the Supabase / dev-bypass viewer, else null (anonymous). The same precedence the org layout and
 * the header already open-code (`session?.login ?? viewer?.login`), lifted here so the surfaces that
 * key DATA on identity — today Shared Org Memory's `visibility='private'` filter, which must never
 * show one author another's scratch — agree on who the caller is instead of each re-deriving it.
 *
 * Must be awaited in a route/render body, never inside a ReadableStream start(): the cookie-scoped
 * reads it depends on return null there (see memory: getviewer-not-in-sse-start).
 *
 * `getSession` is imported lazily so this module keeps its (Edge-safe, supabase-only) import graph —
 * `@/lib/auth` pulls the Node crypto/session stack that `proxy.ts` must not statically depend on.
 */
export async function resolveViewerLogin(): Promise<string | null> {
  const { getSession } = await import("@/lib/auth");
  const session = await getSession();
  if (session?.login) return session.login;
  return (await getViewer())?.login ?? null;
}
