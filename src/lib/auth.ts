// Minimal, dependency-free GitHub OAuth + session. We sign a compact session payload
// with HMAC-SHA256 (AUTH_SECRET) and store it in an httpOnly cookie — the GitHub access
// token is used only server-side during the callback and never persisted to the client.
//
// OAuth credentials are the GitHub App's own Client ID / secret, so a user's token can
// list *their* installations of the App (GET /user/installations) — see docs/GITHUB_APP.md.
// Server-only module (uses next/headers); never import from a client component.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

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
const SESSION_TTL_MS = 7 * 86_400_000;
/** Re-sign + re-set the session cookie once it is within this window of expiry, so
 *  active users get a sliding session instead of an abrupt 7-day logout. */
const SESSION_RENEW_WITHIN_MS = 2 * 86_400_000;
/** Browsers silently drop a cookie whose name+value exceeds ~4KB (the RFC 6265 floor). For a
 *  signed session that presents as an infinite sign-in loop: the callback "succeeds" and
 *  redirects, but the Set-Cookie never sticks, so the user lands logged-out. Keep the encoded
 *  value comfortably under that, leaving headroom for the cookie name and attributes.
 *  `installations` is the only unbounded field, so buildSession trims it to fit and encodeSession
 *  refuses (loudly) anything still over budget. */
const MAX_SESSION_COOKIE_BYTES = 3800;

export interface UserInstallation {
  id: number;
  login: string;
}
export interface Session {
  login: string;
  name?: string;
  image?: string;
  installations: UserInstallation[];
  exp: number;
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
    if (!s.login || typeof s.exp !== "number" || s.exp < Date.now()) return null;
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
}

function sessionCookieAttrs() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  };
}

/**
 * Resolve the current session and, for an active session nearing expiry, slide the
 * window forward: re-sign with a fresh `exp` and re-set the cookie. Distinguishes an
 * expired/invalid cookie ("expired") from no cookie at all ("none") so callers can
 * show a friendly "your session expired" prompt instead of a generic one.
 *
 * Cookies can only be mutated from a Route Handler / Server Action, so the re-set is
 * best-effort: during a Server Component render it throws and is ignored (the cookie
 * then refreshes on the next mutable request).
 */
export async function getSessionState(): Promise<SessionState> {
  if (!isAuthConfigured()) return { session: null, status: "none" };
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return { session: null, status: "none" };

  const session = decodeSession(raw);
  if (!session) return { session: null, status: "expired" };

  if (session.exp - Date.now() < SESSION_RENEW_WITHIN_MS) {
    const renewed: Session = { ...session, exp: Date.now() + SESSION_TTL_MS };
    try {
      store.set(SESSION_COOKIE, encodeSession(renewed), sessionCookieAttrs());
      return { session: renewed, status: "active", expiresAt: renewed.exp };
    } catch {
      /* read-only cookie store (Server Component render) — refresh on a later request. */
    }
  }
  return { session, status: "active", expiresAt: session.exp };
}

/** Current signed-in session, or null. Returns null when auth isn't configured. */
export async function getSession(): Promise<Session | null> {
  return (await getSessionState()).session;
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
    scope: "read:user",
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
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`OAuth token exchange failed: ${data.error ?? res.status}`);
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
 * Build a signed-session payload, capping the embedded installations so the encoded cookie stays
 * under MAX_SESSION_COOKIE_BYTES. A user in many GitHub orgs would otherwise overflow the
 * browser's ~4KB per-cookie limit and be silently logged out in a loop. installations are the
 * only unbounded field, so we drop from the tail until the value fits; dropped orgs degrade
 * gracefully (they read as "public" and are absent from org lists) — strictly better than no
 * session at all. The cap is by encoded size, not a fixed count, because org login lengths vary.
 */
export function buildSession(
  user: { login: string; name?: string; image?: string },
  installations: UserInstallation[],
): Session {
  const exp = Date.now() + SESSION_TTL_MS;
  let kept = installations;
  while (kept.length > 0 && signSession({ ...user, installations: kept, exp }).length > MAX_SESSION_COOKIE_BYTES) {
    kept = kept.slice(0, -1);
  }
  if (kept.length < installations.length) {
    console.warn(
      `[auth] capped installations for ${user.login}: kept ${kept.length} of ${installations.length} to fit the session cookie (${MAX_SESSION_COOKIE_BYTES}B)`,
    );
  }
  return { ...user, installations: kept, exp };
}

export const sessionMaxAgeSeconds = SESSION_TTL_MS / 1000;
