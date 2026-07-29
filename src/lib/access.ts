// The single access gate the rest of the app consults for "is there a signed-in viewer?".
// Layered ON TOP of the dormant custom GitHub OAuth (src/lib/auth.ts): when Supabase auth is
// configured, this is the active login wall; when it isn't (or the dev-bypass flag is set), the
// gate is OPEN and the app behaves exactly as it did before — preserving the auth-off local/demo
// and org-e2e workflows.
//
// Server-only module (reads cookies via the Supabase server client); never import from a client
// component — mirrors the convention in src/lib/auth.ts.

import { cache } from "react";
import { headers } from "next/headers";
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
      // G2-31 — the email fallback is CONFIRMED-ONLY, for the same reason `email` above is. `login` is
      // not merely a display key: it is the identity every org gate resolves a role for
      // (getMembershipRole / viewerOrgRole), and it is what acceptInvite's githubLogin pin compares
      // against. Falling back to the RAW `u.email` therefore reopened the G2-04 hijack through a second
      // field — register an unconfirmed account at victim@example.com and you are logged in AS that
      // string. The invite-create route's GitHub-login shape check (`/^[A-Za-z0-9-]{1,39}$/`) already
      // refuses to STORE an `@` pin, so the two halves fail closed independently. An account with no
      // GitHub metadata and no confirmed address now falls through to the opaque `u.id` — it has no
      // login-scoped standing to re-key, because it could never have proven that identity in the first
      // place. GitHub OAuth sign-ins (the production path) carry `user_name` and never reach either fallback.
      login: meta.user_name ?? meta.preferred_username ?? email ?? u.id,
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
 * True when the CURRENT request looks like a top-level browser navigation (address bar, a clicked
 * `<a href>`, a plain GET form submit) rather than a programmatic `fetch`/`XHR` call.
 *
 * Discrimination (G6-12): browsers attach the Fetch Metadata headers to every request, and reserve
 * `Sec-Fetch-Mode: navigate` EXCLUSIVELY for top-level navigations — a same-origin `fetch()` call
 * (e.g. ExportCsvButton, or any of this app's client-side API calls) sends `cors`/`same-origin`/
 * `no-cors`, never `navigate`, and cannot set this header itself (it's a forbidden header name, so an
 * XHR caller can't spoof it into getting a redirect it would then blindly `follow` and misread as a
 * 200 success). When that header is present it is authoritative. Only when a client omits it entirely
 * (older browsers without Fetch Metadata support; most non-browser HTTP clients) do we fall back to
 * `Accept: text/html`, which every top-level navigation sends and no JSON-expecting caller normally
 * does — still never true for a `fetch()` call made with the default/`application/json` Accept header.
 */
async function looksLikeNavigation(): Promise<boolean> {
  const h = await headers();
  const mode = h.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (h.get("accept") ?? "").includes("text/html");
}

/**
 * API-route gate, the Supabase sibling of requireOrgAccess: returns a 401 NextResponse when the
 * login wall is enforced and there is no viewer, or null when the request may proceed. No-op (null)
 * when the gate is disabled (Supabase unconfigured / bypass on), so existing open behavior is kept.
 *
 * G6-12: a lapsed session hitting a gated route via top-level navigation used to get a raw JSON 401
 * body with no path back to login — a dead end for a human, since nothing on that screen is clickable.
 * Navigable requests (per `looksLikeNavigation`) now get a 303 redirect to the sign-in page instead;
 * every other caller (fetch/XHR — the overwhelming majority of this gate's callers, which parse the
 * JSON body themselves) is completely unaffected and still gets the 401 JSON it already handles.
 */
export async function requireViewer(): Promise<NextResponse | null> {
  if (!authGateEnabled()) return null;
  if (await getViewer()) return null;
  if (await looksLikeNavigation()) {
    // No request/pathname is threaded through this gate (it's called deep inside mutating API routes
    // with no page context to return to), so this sends the visitor to the app's normal sign-in
    // landing rather than guessing at a `next` target it can't verify. Origin is rebuilt from headers
    // the same way publicOriginForRequest (src/lib/auth.ts) does for a proxied deployment — prefer the
    // EXTERNAL forwarded host/proto over any internal one, validating the forwarded host against a
    // plain hostname[:port] grammar so an attacker-controlled header can't rewrite the redirect target
    // (this module deliberately avoids a static import of @/lib/auth's copy — see resolveViewerLogin's
    // comment on keeping this file's Edge-safe import graph).
    const h = await headers();
    const fwdProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const proto = fwdProto === "http" ? "http" : "https";
    const fwdHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = fwdHost && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(fwdHost) ? fwdHost : h.get("host");
    if (host) return NextResponse.redirect(new URL("/connect", `${proto}://${host}`), { status: 303 });
    // No usable host header at all (unexpected outside a real HTTP request, e.g. a malformed proxy) —
    // fail back to the JSON 401 rather than constructing an invalid redirect URL.
  }
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
