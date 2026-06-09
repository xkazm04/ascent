// Minimal, dependency-free GitHub OAuth + session. We sign a compact session payload
// with HMAC-SHA256 (AUTH_SECRET) and store it in an httpOnly cookie — the GitHub access
// token is used only server-side during the callback and never persisted to the client.
//
// OAuth credentials are the GitHub App's own Client ID / secret, so a user's token can
// list *their* installations of the App (GET /user/installations) — see docs/GITHUB_APP.md.
// Server-only module (uses next/headers); never import from a client component.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { isDbConfigured } from "@/lib/db/client";
import { bumpSessionVersion, getSessionVersion } from "@/lib/db/sessions";

export const SESSION_COOKIE = "ascent_session";
export const STATE_COOKIE = "ascent_oauth_state";
export const NEXT_COOKIE = "ascent_oauth_next";
/** Marks an in-flight OAuth round-trip as a "re-sync access" rather than a fresh sign-in,
 *  so the callback lands back on the originating page (skipping the /launch cinematic) and
 *  surfaces a "re-synced" confirmation instead. Short-lived, like STATE/NEXT. */
export const RESYNC_COOKIE = "ascent_oauth_resync";
/** Remembers the viewer's active org/workspace across visits (the header switcher). Not
 *  security-sensitive: it only selects a default tenant context and is always re-validated
 *  against the session's installations before use, so a stale/tampered value can't widen access. */
export const ACTIVE_ORG_COOKIE = "ascent_active_org";
/** The shared, non-org context for public scans. */
export const PUBLIC_ORG = "public";
/** Inactivity horizon (`rexp`): the hard cap on how long a session survives without
 *  activity. Silent refresh slides it forward on each active request, so an active user is
 *  never abruptly logged out, while an idle session lapses after this window. */
const SESSION_TTL_MS = 7 * 86_400_000;
/** Short access lifetime (`exp`): how long a token is trusted on its own before the server
 *  must re-affirm it against the revocation store and re-mint it. This is the teeth behind
 *  server-side revocation — even if the version check can't run (DB blip), an unaffirmed
 *  token can't outlive this window. Much shorter than the inactivity horizon. */
const ACCESS_TTL_MS = 60 * 60_000; // 60 minutes
/** Refresh the access token once it is within this window of its short expiry, so normal
 *  browsing transparently re-mints (and re-checks revocation) well before it lapses. */
const ACCESS_RENEW_WITHIN_MS = 30 * 60_000; // 30 minutes
/** Browsers silently drop a cookie whose name+value exceeds ~4KB (the RFC 6265 floor). For a
 *  signed session that presents as an infinite sign-in loop: the callback "succeeds" and
 *  redirects, but the Set-Cookie never sticks, so the user lands logged-out. Keep the encoded
 *  value comfortably under that, leaving headroom for the cookie name and attributes.
 *  `installations` is the only unbounded field, so buildSession trims it to fit and encodeSession
 *  refuses (loudly) anything still over budget. */
const MAX_SESSION_COOKIE_BYTES = 3800;
/** Defensive backstop on the embedded org suggestions (the caller already caps them tighter). They
 *  are a pure onboarding nicety, so buildSession drops them before trimming access-granting
 *  installations when the cookie is tight. */
const MAX_SESSION_SUGGESTED_ORGS = 8;

export interface UserInstallation {
  id: number;
  login: string;
}
export interface Session {
  login: string;
  name?: string;
  image?: string;
  installations: UserInstallation[];
  /** Short access expiry (epoch ms): when the server must re-affirm + re-mint the token. */
  exp: number;
  /** Refresh/inactivity horizon (epoch ms): the hard expiry decodeSession enforces. Optional
   *  for backward compatibility with legacy cookies that carried only the long `exp`. */
  rexp?: number;
  /** Session version this token was minted at, compared against the per-login stored version
   *  for server-side revocation. Absent on legacy cookies, which read as version 0. */
  sv?: number;
  /** Orgs the user belongs to but hasn't installed the App on, discovered at login and surfaced
   *  as onboarding suggestions ("scan this org first"), most-active first. The lowest-priority
   *  cookie field — dropped before installations when the cookie is tight. Optional/back-compat. */
  suggestedOrgs?: string[];
  /** The most-active org whose watchlist we pre-seeded at login (its dashboard already has a
   *  fleet to act on), so onboarding can point the user straight at it. Optional/back-compat. */
  seededOrg?: string;
}

/** Org auto-discovery results to embed in the session (see src/lib/github/discover.ts). */
export interface SessionDiscovery {
  suggestedOrgs?: string[];
  seededOrg?: string;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_OAUTH_CLIENT_ID &&
      process.env.GITHUB_OAUTH_CLIENT_SECRET &&
      process.env.AUTH_SECRET,
  );
}

function hmac(data: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(data).digest("base64url");
}

/** Sign a session into its `payload.hmac` cookie value. The value is pure base64url + ".", i.e.
 *  ASCII, so `value.length` equals its byte length — used by both encodeSession (the size guard)
 *  and buildSession (size-aware trimming). */
function signSession(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function encodeSession(s: Session): string {
  const value = signSession(s);
  if (value.length > MAX_SESSION_COOKIE_BYTES) {
    // Fail loudly rather than hand the browser a cookie it will silently discard (which strands
    // the user in a sign-in loop). The callback's try/catch turns this into a visible
    // error=oauth_failed and we get a server log naming the user and size. buildSession caps
    // installations to fit, so this is a backstop for pathological payloads / future callers.
    console.error(
      `[auth] refusing oversized session cookie for ${s.login}: ${value.length}B > ${MAX_SESSION_COOKIE_BYTES}B (${s.installations.length} installations)`,
    );
    throw new Error("session cookie payload exceeds size limit");
  }
  return value;
}

export function decodeSession(value: string): Session | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!s.login || typeof s.exp !== "number") return null;
    // The hard expiry is the inactivity horizon (`rexp`); the short access `exp` only gates
    // silent refresh (see getSessionState) and must NOT reject here, or an idle-but-valid
    // session would read as expired the moment its access window lapsed. Legacy cookies
    // predate `rexp` and carry only the old long-lived `exp`, so fall back to it.
    const horizon = typeof s.rexp === "number" ? s.rexp : s.exp;
    if (horizon < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

/** Whether a session is active, expired (cookie present but invalid/expired), or absent. */
export type SessionStatus = "active" | "expired" | "none";

export interface SessionState {
  session: Session | null;
  status: SessionStatus;
  /** Epoch ms when the (possibly renewed) session expires, when active. */
  expiresAt?: number;
  /** True when the access window is within the renew threshold but the cookie could NOT be re-minted
   *  here (a read-only Server Component render). A mutable context (Route Handler / Server Action) can
   *  read this and re-mint on the next request, so a read-mostly surface doesn't starve the refresh. */
  needsRefresh?: boolean;
}

function sessionCookieAttrs(secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  };
}

/**
 * Whether the session cookie should carry `Secure`. Derived from the request's forwarded proto so
 * it matches how the login/callback routes set it (`origin.startsWith("https")`) rather than
 * `NODE_ENV`: a production deployment terminating TLS with `NODE_ENV` unset, or any HTTPS staging
 * build with `NODE_ENV !== production`, would otherwise re-mint the cookie WITHOUT `Secure` and let
 * it leak over plaintext. `NODE_ENV === "production"` still forces it on as a backstop, and plain
 * http (local dev) correctly stays non-Secure so the cookie works on localhost.
 */
export async function secureCookieForRequest(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return true;
  try {
    const proto = (await headers()).get("x-forwarded-proto");
    return proto?.split(",")[0]?.trim() === "https";
  } catch {
    return false;
  }
}

/** Outcome of checking a token's `sv` against the per-login stored version:
 *  - `valid`   — the revocation store confirmed this token is current.
 *  - `revoked` — a newer version exists; the token is dead (logout / access change).
 *  - `unknown` — no authority to check (DB unconfigured) or the lookup failed; we can
 *                neither confirm nor disprove, so the short access TTL governs instead. */
type VersionVerdict = "valid" | "revoked" | "unknown";

async function verifySessionVersion(session: Session): Promise<VersionVerdict> {
  if (!isDbConfigured()) return "unknown"; // stateless mode — no revocation authority
  try {
    const stored = await getSessionVersion(session.login);
    return stored > (session.sv ?? 0) ? "revoked" : "valid";
  } catch (err) {
    // Fail open on a transient DB error: we can't prove the session is revoked, and
    // logging every signed-in user out because the revocation store hiccuped would be its
    // own outage. The short access TTL still caps how long an unaffirmed token survives.
    console.warn(`[auth] session-version check failed for ${session.login}; allowing within access TTL`, err);
    return "unknown";
  }
}

/**
 * Resolve the current session, enforcing server-side revocation and sliding the access
 * window forward for active users.
 *
 * Revocation: a logout (or access change) bumps the login's stored session version; a
 * token minted at an older version is rejected here on its *next* resolve — so logout is
 * real and takes effect immediately, not after the cookie TTL runs out. The check is a
 * single primary-key lookup, run on every resolve.
 *
 * Silent refresh: the token carries a short access `exp`. Once it is spent (or nearly so)
 * the cookie is re-minted with a fresh access window and the inactivity horizon (`rexp`)
 * slid forward — but only when the version check positively affirmed it (or there is no
 * DB authority). Past the short access `exp`, an unaffirmed token (revoked, or a DB blip)
 * is treated as expired: that short TTL is the backstop that bounds a stolen cookie's life
 * even when the version lookup can't run.
 *
 * Distinguishes an expired/invalid cookie ("expired") from no cookie at all ("none") so
 * callers can show a friendly "your session expired" prompt. Cookies can only be mutated
 * from a Route Handler / Server Action, so the re-mint is best-effort: during a Server
 * Component render it throws and is ignored (the cookie refreshes on the next mutable
 * request, and is still valid in the meantime).
 */
export async function getSessionState(): Promise<SessionState> {
  if (!isAuthConfigured()) return { session: null, status: "none" };
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return { session: null, status: "none" };

  const session = decodeSession(raw);
  if (!session) return { session: null, status: "expired" };

  const verdict = await verifySessionVersion(session);
  if (verdict === "revoked") return { session: null, status: "expired" };

  const now = Date.now();
  const horizon = typeof session.rexp === "number" ? session.rexp : session.exp;

  // Past its short access TTL, a token may only continue if the revocation store affirmed
  // it ("valid"). If the DB is the authority but couldn't answer ("unknown"), let the
  // short-lived token lapse rather than trust it indefinitely. Stateless mode (no DB) has
  // no authority, so the inactivity horizon governs alone — the prior behavior.
  if (now >= session.exp && isDbConfigured() && verdict !== "valid") {
    return { session: null, status: "expired" };
  }

  // Silent refresh: re-mint once the access window is within the renew threshold, sliding
  // both the access `exp` and the inactivity horizon forward (capped by the configured
  // lifetimes). Never refresh an unaffirmed DB-mode token — that would extend a possibly
  // revoked session past its access TTL.
  const canRefresh = !isDbConfigured() || verdict === "valid";
  if (canRefresh && now >= session.exp - ACCESS_RENEW_WITHIN_MS) {
    const renewed: Session = { ...session, exp: now + ACCESS_TTL_MS, rexp: now + SESSION_TTL_MS };
    try {
      store.set(SESSION_COOKIE, encodeSession(renewed), sessionCookieAttrs(await secureCookieForRequest()));
      return { session: renewed, status: "active", expiresAt: renewed.rexp };
    } catch {
      // Read-only cookie store (Server Component render) — the re-mint can't be written here. A
      // read-mostly surface (dashboards rendered as Server Components) can otherwise starve the refresh
      // until the short access exp lapses and abruptly log out an actively-browsing user. Surface it:
      // return active + needsRefresh so a Route Handler / Server Action re-mints on the next mutable
      // request, and log so the starvation is observable instead of silently swallowed.
      console.warn(
        `[auth] session re-mint skipped (read-only store) for ${session.login}; will refresh on next mutable request`,
      );
      return { session, status: "active", expiresAt: horizon, needsRefresh: true };
    }
  }
  return { session, status: "active", expiresAt: horizon };
}

/** Current signed-in session, or null. Returns null when auth isn't configured. */
export async function getSession(): Promise<Session | null> {
  return (await getSessionState()).session;
}

/**
 * "Sign out everywhere else": revoke every OTHER session for this login while keeping the current
 * browser signed in. Bumps the login's stored session version — so every token minted at the prior
 * version (other devices, or a leaked/stolen cookie copy) is rejected on its next resolve — then
 * re-mints THIS browser's cookie at the new version so it alone survives. Returns whether the
 * revocation actually had authority: with no DB, bumpSessionVersion is a no-op (version 0) and
 * there is nothing to revoke, so this returns false (the cookie is still refreshed, harmlessly).
 * Must run inside a Route Handler / Server Action — it writes the session cookie.
 */
export async function revokeOtherSessions(session: Session): Promise<boolean> {
  const newVersion = await bumpSessionVersion(session.login); // 0 in stateless mode (no authority)
  const now = Date.now();
  const renewed: Session = { ...session, sv: newVersion, exp: now + ACCESS_TTL_MS, rexp: now + SESSION_TTL_MS };
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(renewed), sessionCookieAttrs(await secureCookieForRequest()));
  return isDbConfigured();
}

/**
 * The org slug a viewer is allowed to read scan data for `owner` under. Private
 * GitHub-App scans are stored under the owner's own org (login, lowercased); public
 * scans live under the shared "public" org. A viewer may read the owner's org only when
 * their session has an installation for it — otherwise they fall back to "public". This
 * is authorization derived from the session cookie (sent automatically), so it both
 * prevents cross-tenant reads and avoids exposing an unauthenticated org parameter.
 */
export async function readableOrgForOwner(owner: string): Promise<string> {
  const ownerLc = owner.toLowerCase();
  const session = await getSession();
  return session?.installations.some((i) => i.login.toLowerCase() === ownerLc) ? ownerLc : "public";
}

/**
 * The org contexts a viewer can switch between in the header: each of their GitHub-App
 * installations (by login), plus the shared "public" context. De-duplicated case-insensitively,
 * with "public" always offered last. Returns the original login casing (matching the slugs the
 * connect / org-dashboard flows already use).
 */
export function orgOptionsForSession(session: Session | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of session?.installations ?? []) {
    const lc = i.login.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(i.login);
  }
  if (!seen.has(PUBLIC_ORG)) out.push(PUBLIC_ORG);
  return out;
}

/**
 * The viewer's remembered active org: read from the ACTIVE_ORG cookie and validated against the
 * session's selectable options, so a stale or hand-set cookie can never select an org the viewer
 * can't access. Falls back to the first installation (matching the prior /usage default), then
 * "public". Returns the canonical option (preserving login casing).
 */
export async function getActiveOrg(session?: Session | null): Promise<string> {
  const s = session === undefined ? await getSession() : session;
  const options = orgOptionsForSession(s);
  const store = await cookies();
  const raw = store.get(ACTIVE_ORG_COOKIE)?.value;
  if (raw) {
    const match = options.find((o) => o.toLowerCase() === raw.toLowerCase());
    if (match) return match;
  }
  return s?.installations[0]?.login ?? PUBLIC_ORG;
}

/**
 * True when a request demonstrably comes from this same origin — the CSRF guard shared by the
 * state-changing POST handlers (logout, session revocation). Prefers the Origin header's host;
 * for same-origin top-level navigations that omit Origin, falls back to the Sec-Fetch-Site
 * fetch-metadata. Single-sourced here so the handlers can't drift apart.
 */
export function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/**
 * Validate a post-login `next` redirect target. Returns a safe, same-origin, path-only
 * destination, or `fallback` for anything that could escape the origin: absolute URLs,
 * protocol-relative `//host`, backslash variants `/\host`, control chars/whitespace, or
 * non-path values. Shared by the login and callback routes so their validation can
 * never drift apart.
 */
export function safeNext(next: string | null | undefined, fallback = "/connect"): string {
  if (!next || typeof next !== "string") return fallback;
  // Must be root-relative, but not protocol-relative ("//host") or a backslash variant
  // ("/\\host") — both resolve to an external origin in browsers / the URL parser.
  if (next[0] !== "/" || next[1] === "/" || next[1] === "\\") return fallback;
  if (next.includes("\\")) return fallback;
  // Reject control chars / whitespace that can smuggle a host past naive checks.
  if (/[ -\s]/.test(next)) return fallback;
  try {
    const url = new URL(next, "https://ascent.invalid");
    if (url.origin !== "https://ascent.invalid") return fallback;
    const cleaned = url.pathname + url.search + url.hash;
    if (cleaned[0] !== "/" || cleaned[1] === "/") return fallback;
    return cleaned;
  } catch {
    return fallback;
  }
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
    redirect_uri: `${origin}/api/auth/callback`,
    // `read:org` lets the callback list the orgs the user belongs to (GET /user/orgs) so we can
    // suggest which to scan first and pre-seed the watchlist for their most-active org — the
    // Vercel/Dependabot onboarding pattern. (For a GitHub App user-to-server token this scope is
    // advisory; access is governed by the App's permissions. Org discovery degrades gracefully
    // if the listing is denied — see src/lib/github/discover.ts.)
    scope: "read:user read:org",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, origin: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/callback`,
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    // Surface GitHub's human-readable error_description (e.g. "The code passed is incorrect or
    // expired.") rather than just the terse error code / HTTP status — it's the diagnosable detail.
    throw new Error(`OAuth token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token;
}

/** Error carrying the GitHub HTTP status, so callers can tell transient (rate limit /
 *  outage) failures apart from permanent ones. */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GitHub ${status} on ${path}`);
    this.name = "GitHubError";
  }
}

const TRANSIENT_STATUS = new Set([403, 429, 500, 502, 503, 504]);

/** A transient failure worth retrying: rate limit / brief outage, or a network error. */
function isTransientGithubError(err: unknown): boolean {
  if (err instanceof GitHubError) return TRANSIENT_STATUS.has(err.status);
  return err instanceof TypeError; // fetch network failure
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Run a GitHub call with bounded exponential backoff on transient failures. */
async function withGithubRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransientGithubError(err)) throw err;
      await sleep(250 * 2 ** attempt); // 250ms, 500ms
    }
  }
  throw lastErr;
}

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ascent-maturity-scanner",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new GitHubError(res.status, path);
  return (await res.json()) as T;
}

export async function fetchGithubUser(token: string): Promise<{ login: string; name?: string; image?: string }> {
  const u = await gh<{ login: string; name: string | null; avatar_url: string }>("/user", token);
  return { login: u.login, name: u.name ?? undefined, image: u.avatar_url };
}

/**
 * List the GitHub App installations the signed-in user can access.
 *
 * Retries transient failures (rate limit / brief outage) with backoff, then THROWS —
 * login happens exactly when GitHub API pressure is highest, and the old
 * `catch { return [] }` baked an empty-installations array into a 7-day session,
 * silently locking the user out of every org feature until the cookie expired. The
 * callback turns a throw into `error=oauth_failed` instead. Installations whose
 * account is missing are skipped (null-guarded), not crashed on.
 */
export async function fetchUserInstallations(token: string): Promise<UserInstallation[]> {
  const data = await withGithubRetry(() =>
    gh<{ installations: { id: number; account: { login: string } | null }[] }>(
      "/user/installations?per_page=100",
      token,
    ),
  );
  return data.installations
    .filter((i): i is { id: number; account: { login: string } } => Boolean(i.account?.login))
    .map((i) => ({ id: i.id, login: i.account.login }));
}

/**
 * Build a signed-session payload, stamping it with the current session version (`sv`) for
 * server-side revocation and with both a short access expiry (`exp`) and the inactivity
 * horizon (`rexp`) for silent refresh. Caps the embedded installations so the encoded
 * cookie stays under MAX_SESSION_COOKIE_BYTES — a user in many GitHub orgs would otherwise
 * overflow the browser's ~4KB per-cookie limit and be silently logged out in a loop.
 * installations are the only unbounded field, so we drop from the tail until the value
 * fits; dropped orgs degrade gracefully (they read as "public" and are absent from org
 * lists) — strictly better than no session at all. The cap is by encoded size, not a fixed
 * count, because org login lengths vary. `sv` comes from getSessionVersion(login) at login.
 */
export function buildSession(
  user: { login: string; name?: string; image?: string },
  installations: UserInstallation[],
  sv = 0,
  discovery: SessionDiscovery = {},
): Session {
  const now = Date.now();
  const exp = now + ACCESS_TTL_MS;
  const rexp = now + SESSION_TTL_MS;

  // Build the candidate session for the current trim state. The discovered-org fields are the
  // only ones besides installations that vary in size, so they're folded in here (and omitted
  // when empty so a discovery-free login round-trips to exactly the legacy shape).
  let kept = installations;
  let suggestedOrgs = (discovery.suggestedOrgs ?? []).slice(0, MAX_SESSION_SUGGESTED_ORGS);
  let seededOrg = discovery.seededOrg;
  const assemble = (): Session => ({
    ...user,
    installations: kept,
    exp,
    rexp,
    sv,
    ...(suggestedOrgs.length ? { suggestedOrgs } : {}),
    ...(seededOrg ? { seededOrg } : {}),
  });
  const overBudget = () => signSession(assemble()).length > MAX_SESSION_COOKIE_BYTES;

  // Shed the lowest-value fields first — onboarding suggestions, then the seeded-org pointer —
  // before falling back to tail-dropping installations, which gate access and must survive longest.
  if (overBudget()) suggestedOrgs = [];
  if (overBudget()) seededOrg = undefined;
  while (kept.length > 0 && overBudget()) {
    kept = kept.slice(0, -1);
  }
  if (kept.length < installations.length) {
    console.warn(
      `[auth] capped installations for ${user.login}: kept ${kept.length} of ${installations.length} to fit the session cookie (${MAX_SESSION_COOKIE_BYTES}B)`,
    );
  }
  return assemble();
}

export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000;
