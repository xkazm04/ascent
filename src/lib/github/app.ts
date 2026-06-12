// GitHub App authentication — mints App JWTs (RS256) and short-lived installation access
// tokens using Node's built-in crypto (no extra deps), so private repos can be scanned
// with the customer's installation. Everything degrades to "not configured" when the
// GITHUB_APP_* env vars are absent, so the rest of the app keeps working.
//
// Setup: see docs/GITHUB_APP.md.

import { createHmac, createSign, timingSafeEqual } from "crypto";

const API = "https://api.github.com";

export interface AppRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  url: string;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}

export interface InstallationInfo {
  id: number;
  account: string; // login
  type: string; // "User" | "Organization"
  /** ISO timestamp when GitHub suspended the installation, or null if active. Lets a destructive
   *  webhook (suspend) be confirmed against GitHub's authoritative state before we act on it. */
  suspendedAt: string | null;
}

export function isAppConfigured(): boolean {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
}

export function appInstallUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}

// The per-installation Configure page (where repo access is granted) lives in @/lib/ui — a
// client-safe module, since the connect client components build it too — and is re-exported
// here so server callers keep importing all App URLs from one place.
export { appConfigureUrl } from "@/lib/ui";

/** Accepts a raw PEM (with literal or escaped newlines) or a base64-encoded PEM. */
function getPrivateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? "";
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return raw;
  }
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Short-lived (10 min) RS256 JWT authenticating as the App itself. */
export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID not set");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(getPrivateKey()).toString("base64url");
  return `${data}.${sig}`;
}

/** Error from a GitHub App API call, carrying the HTTP status so callers can react to 401s. */
export class AppApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`GitHub App API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "AppApiError";
  }
}

/**
 * Authenticated GitHub API call (App JWT or installation token as the bearer). Exported so the
 * write surfaces (github/write.ts, github/checks.ts) reuse one fetch with consistent headers +
 * AppApiError handling. Throws AppApiError on a non-2xx so callers can branch on `.status`.
 */
export async function githubAppFetch<T>(path: string, auth: string, init: RequestInit = {}): Promise<T> {
  return ghApp<T>(path, auth, init);
}

async function ghApp<T>(path: string, auth: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${auth}`,
      "User-Agent": "ascent-maturity-scanner",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppApiError(res.status, path, body);
  }
  return (await res.json()) as T;
}

export async function getInstallation(installationId: number | string): Promise<InstallationInfo> {
  const jwt = createAppJwt();
  const data = await ghApp<{
    id: number;
    account: { login: string; type: string };
    suspended_at?: string | null;
  }>(`/app/installations/${installationId}`, jwt);
  return {
    id: data.id,
    account: data.account.login,
    type: data.account.type,
    suspendedAt: data.suspended_at ?? null,
  };
}

// Cache installation tokens (valid ~1h) to avoid minting one per request.
const tokenCache = new Map<string, { token: string; expires: number }>();

// Re-mint this far BEFORE GitHub's stated expiry. The buffer absorbs (a) a token expiring mid-request
// and (b) host-clock skew vs GitHub's clock: if the host clock runs behind real time by up to this
// margin, a token GitHub already considers expired would otherwise still look fresh locally and 401.
// 60s only covered (a); under-provisioned hosts without reliable NTP can drift minutes, so widen to
// 3 min — negligible against a ~1h token lifetime.
const TOKEN_EXPIRY_SKEW_MS = 180_000;

/** Drop a cached installation token (e.g. after a 401 — the installation may be suspended,
 *  uninstalled, or its access changed). The next call re-mints. */
export function invalidateInstallationToken(installationId: number | string): void {
  tokenCache.delete(String(installationId));
}

export async function getInstallationToken(
  installationId: number | string,
  forceRefresh = false,
): Promise<string> {
  const key = String(installationId);
  const cached = tokenCache.get(key);
  // Treat a NaN/unparseable expiry (malformed expires_at) or a past expiry as "must re-mint",
  // rather than letting `NaN > …` silently evaluate false and trust a stale token.
  if (
    !forceRefresh &&
    cached &&
    Number.isFinite(cached.expires) &&
    cached.expires > Date.now() + TOKEN_EXPIRY_SKEW_MS
  ) {
    return cached.token;
  }

  const jwt = createAppJwt();
  const data = await ghApp<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: "POST" },
  );
  const expires = new Date(data.expires_at).getTime();
  tokenCache.set(key, { token: data.token, expires });
  return data.token;
}

interface GhRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
}

/**
 * List ALL repositories an installation can access. The endpoint pages at 100/req; the old
 * single-page fetch silently dropped everything past repo #100 — invisible to watch/schedule/
 * scan and wrong in the "X of N watched" counter. We walk every page using `total_count`
 * (and a short-page stop), bounded by MAX_PAGES so a pathological response can't loop forever.
 */
export async function listInstallationRepos(installationId: number | string): Promise<AppRepo[]> {
  const PER_PAGE = 100;
  const MAX_PAGES = 50; // safety bound — up to 5000 repos

  // Self-heal a stale token: a cached installation token can outlive the installation's access
  // (suspend/uninstall/permission change), so on a 401 we drop it and retry ONCE with a freshly
  // minted token instead of failing for up to an hour until the cache entry expires.
  const collect = async (token: string): Promise<GhRepo[]> => {
    const raw: GhRepo[] = [];
    let total = Infinity;
    for (let page = 1; page <= MAX_PAGES && raw.length < total; page++) {
      const data = await ghApp<{ total_count: number; repositories: GhRepo[] }>(
        `/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
        token,
      );
      total = typeof data.total_count === "number" ? data.total_count : raw.length + data.repositories.length;
      raw.push(...data.repositories);
      if (data.repositories.length < PER_PAGE) break; // last (short) page
    }
    // Surface a silent truncation: an installation with more than MAX_PAGES×PER_PAGE repos would
    // otherwise drop the overflow with no signal — invisible to watch/schedule/scan and wrong in
    // the "X of N watched" counter.
    if (Number.isFinite(total) && raw.length < total) {
      console.warn(
        `[github/app] installation ${installationId}: listed ${raw.length} of ${total} repos (capped at MAX_PAGES=${MAX_PAGES}); the rest are not visible to watch/scan.`,
      );
    }
    return raw;
  };

  let raw: GhRepo[];
  try {
    raw = await collect(await getInstallationToken(installationId));
  } catch (err) {
    if (err instanceof AppApiError && err.status === 401) {
      invalidateInstallationToken(installationId);
      raw = await collect(await getInstallationToken(installationId, true));
    } else {
      throw err;
    }
  }

  // Drop forks + archived repos, matching the public listing (listOrgRepos) and discovery
  // (fetchUserRepos): that isn't where active engineering happens, and otherwise they clutter the
  // connect watch-list and can burn a user's onboarding/watch budget on dead mirrors.
  return raw
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      private: r.private,
      url: r.html_url,
      language: r.language,
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
    }));
}

/** Verify a webhook payload against the X-Hub-Signature-256 header. */
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
