// Org auto-discovery — turns a fresh sign-in into a populated dashboard.
//
// After OAuth, the callback knows only the user's GitHub App installations, so a brand-new user
// lands on an empty org view until they manually connect repos. This module closes that gap:
// using the (short-lived) user token, it lists the orgs the user belongs to and the repos they
// most recently pushed to, then ranks each org by how actively the user works in it. The callback
// uses that ranking to (a) suggest which orgs to scan first in onboarding and (b) pre-seed the
// watchlist for the most-active org.
//
// Two layers, separated so the ranking stays pure and unit-testable:
//   • fetchUserOrgs / fetchUserRepos — thin GitHub calls (throw on a hard error; the caller treats
//     discovery as best-effort and degrades, so login is never blocked).
//   • rankDiscoveredOrgs / selectSuggestedOrgLogins / selectSeedTarget — pure transforms over the
//     fetched data, with no I/O.

import { githubApiBase } from "@/lib/github/host";

// BUG (github-repo-data-access #1): this module was the only github layer hardcoding api.github.com,
// so org auto-discovery ignored the GHES `GITHUB_API_URL` override and broke (firewalled/401) on
// enterprise deployments. Route through githubApiBase() like source.ts/list.ts/governance.ts/app.ts.
// Resolved per-call so a test/env that sets GITHUB_API_URL after import is honored.

/** A repo from the signed-in user's listing (GET /user/repos), normalized. */
export interface UserRepo {
  owner: string; // owner login (canonical casing)
  ownerType: string; // "User" | "Organization"
  name: string;
  fullName: string; // "owner/name"
  url: string;
  isPrivate: boolean;
  pushedAt: string | null;
}

/** An org the user belongs to (or actively pushes to), with an activity profile. */
export interface DiscoveredOrg {
  login: string; // canonical login casing (for display / public listing)
  slug: string; // lowercased — the org slug used everywhere else in the app
  installed: boolean; // the Ascent GitHub App is already installed on this org
  repoCount: number; // user's recently-pushed repos owned by this org (activity proxy)
  lastPushedAt: string | null; // most recent push across this org's repos (ISO), for tie-breaks
  topRepos: UserRepo[]; // this org's repos, most-recently-pushed first
}

/** A watchlist seed candidate: the org slug + the repos to pre-watch under it. */
export interface SeedTarget {
  slug: string;
  repos: { owner: string; name: string; fullName: string; url: string; isPrivate: boolean }[];
}

/** How many not-yet-installed orgs to surface as onboarding suggestions. */
export const MAX_SUGGESTED_ORGS = 6;
/** How many repos to pre-seed into the watchlist for the most-active org. */
export const MAX_SEED_REPOS = 5;

interface GhRepo {
  name: string;
  full_name: string;
  owner: { login: string; type: string };
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushed_at: string | null;
}

async function ghUser<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${githubApiBase()}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ascent-org-discovery",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/** Org logins the user is a member of (GET /user/orgs). Best-effort: the caller catches failures. */
export async function fetchUserOrgs(token: string): Promise<string[]> {
  const data = await ghUser<{ login: string }[]>("/user/orgs?per_page=100", token);
  return data.map((o) => o.login).filter(Boolean);
}

/**
 * The user's repos, most-recently-pushed first (GET /user/repos) — the activity signal behind
 * ranking. Forks/archived repos are dropped (they aren't where active work happens, and we don't
 * want to seed them), mirroring the public listing in github/list.ts.
 */
export async function fetchUserRepos(token: string, perPage = 100): Promise<UserRepo[]> {
  const data = await ghUser<GhRepo[]>(
    `/user/repos?sort=pushed&direction=desc&per_page=${Math.min(100, Math.max(1, perPage))}`,
    token,
  );
  return data
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      owner: r.owner.login,
      ownerType: r.owner.type,
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      isPrivate: r.private,
      pushedAt: r.pushed_at,
    }));
}

/**
 * Rank the orgs the user belongs to by how actively they work in each — the basis for both the
 * onboarding suggestions and the watchlist seed. An org is "discovered" if the user is a member
 * (from /user/orgs) OR owns recently-pushed repos under it (from /user/repos, org-type owners
 * only). Each org's activity is the count of the user's recent repos it owns, tie-broken by the
 * most recent push. Active orgs (≥1 repo) lead, sorted by count then recency; membership-only orgs
 * follow in their /user/orgs order. The user's own account is excluded (it isn't an org).
 */
export function rankDiscoveredOrgs(opts: {
  orgLogins: string[];
  repos: UserRepo[];
  installedSlugs: string[];
  viewerLogin: string;
}): DiscoveredOrg[] {
  const viewer = opts.viewerLogin.toLowerCase();
  const installed = new Set(opts.installedSlugs.map((s) => s.toLowerCase()));

  // Canonical login per slug, and the membership order from /user/orgs (for the stable tie-break).
  const loginBySlug = new Map<string, string>();
  const membershipOrder = new Map<string, number>();
  opts.orgLogins.forEach((login, i) => {
    const slug = login.toLowerCase();
    if (slug === viewer) return;
    if (!loginBySlug.has(slug)) loginBySlug.set(slug, login);
    if (!membershipOrder.has(slug)) membershipOrder.set(slug, i);
  });

  // Bucket the user's recent repos by owning org (org-type owners only — personal repos aren't orgs).
  const reposBySlug = new Map<string, UserRepo[]>();
  for (const r of opts.repos) {
    const slug = r.owner.toLowerCase();
    if (slug === viewer || r.ownerType !== "Organization") continue;
    if (!loginBySlug.has(slug)) loginBySlug.set(slug, r.owner);
    const arr = reposBySlug.get(slug) ?? [];
    arr.push(r);
    reposBySlug.set(slug, arr);
  }

  const orgs: DiscoveredOrg[] = [...loginBySlug.keys()].map((slug) => {
    const topRepos = [...(reposBySlug.get(slug) ?? [])].sort(
      (a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""),
    );
    return {
      login: loginBySlug.get(slug)!,
      slug,
      installed: installed.has(slug),
      repoCount: topRepos.length,
      lastPushedAt: topRepos[0]?.pushedAt ?? null,
      topRepos,
    };
  });

  return orgs.sort((a, b) => {
    if (a.repoCount !== b.repoCount) return b.repoCount - a.repoCount; // most active first
    const recency = (b.lastPushedAt ?? "").localeCompare(a.lastPushedAt ?? "");
    if (recency !== 0) return recency;
    const am = membershipOrder.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const bm = membershipOrder.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    if (am !== bm) return am - bm; // stable: preserve /user/orgs order
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * The not-yet-installed orgs to surface as onboarding suggestions ("scan this org first"), most
 * active first. Installed orgs are omitted — they already appear in the installation picker and the
 * fleet map.
 */
export function selectSuggestedOrgLogins(orgs: DiscoveredOrg[], max = MAX_SUGGESTED_ORGS): string[] {
  return orgs
    .filter((o) => !o.installed)
    .slice(0, max)
    .map((o) => o.login);
}

/**
 * The watchlist seed: the most-active org plus its top repos. When the org isn't installed we can't
 * mint an installation token, so only PUBLIC repos are seeded (private ones could never be scanned
 * and would sit as dead watchlist rows). Returns null when no discovered org has seedable repos.
 */
export function selectSeedTarget(orgs: DiscoveredOrg[], maxRepos = MAX_SEED_REPOS): SeedTarget | null {
  for (const org of orgs) {
    if (org.repoCount === 0) continue; // ranked, so the first with repos is the most active
    const usable = org.installed ? org.topRepos : org.topRepos.filter((r) => !r.isPrivate);
    if (usable.length === 0) continue;
    return {
      slug: org.slug,
      repos: usable.slice(0, maxRepos).map((r) => ({
        owner: r.owner,
        name: r.name,
        fullName: r.fullName,
        url: r.url,
        isPrivate: r.isPrivate,
      })),
    };
  }
  return null;
}
