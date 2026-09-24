// Which repositories an org may WATCH (backlog develop-2026-09-17 row 39).
//
// A watched repo is a standing credit draw: the rescan cron reserves the org's credits for it on its
// cadence and folds its score into the org's rollup. POST /api/org/watch used to accept any
// `{ owner, name, fullName }`, so a member could point the org's scan budget at a competitor or a
// stranger's fork. This module is the ONE predicate that route asks.
//
// Two modes, keyed on `selfHosted()` (its three-state read is documented in src/lib/env.ts):
//   - HOSTED: the repo must be the org's own (`owner === org`, case-insensitive) or appear on the
//     org's GitHub App installation listing. The owner check is a fast path that needs no read; the
//     listing is read once per request (lazily, only for a non-owner name) and FAILS CLOSED: an org
//     with no installation, or a listing GitHub would not serve, admits only its own namespace.
//   - SELF-HOSTED: free-form. The operator owns the deployment, the tokens and the bill, and an org
//     named for its team (`kiro`) watching repositories under another account (`xkazm04/*`) is the
//     documented shape of a self-host.
//
// The handle SHAPE is checked in both modes: a GitHub login, a repo name, and a `fullName` that is
// exactly `owner/name`. That is the same grammar the import route applies to its `repos[]`.
//
// Install-granted auto-watch (`watchGrantedRepo` in src/lib/db/install-grants.ts) does NOT call this:
// its input IS the installation listing, so every name it watches satisfies the hosted rule by
// construction.

import { selfHosted } from "@/lib/env";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { listInstallationReposResult } from "@/lib/github/app";
import { isValidHandle, isValidRepoName } from "@/lib/github/list";

/** A watch coordinate whose shape has been checked. */
export interface WatchHandle {
  owner: string;
  name: string;
  fullName: string;
}

/** `{ owner, name, fullName }` with a valid GitHub shape, or null. Makes no claim about ownership. */
export function parseWatchHandle(input: { owner?: unknown; name?: unknown; fullName?: unknown }): WatchHandle | null {
  const { owner, name, fullName } = input;
  if (typeof owner !== "string" || typeof name !== "string" || typeof fullName !== "string") return null;
  if (!isValidHandle(owner) || !isValidRepoName(name)) return null;
  if (fullName.toLowerCase() !== `${owner}/${name}`.toLowerCase()) return null;
  return { owner, name, fullName };
}

/** Does this org's watch scope admit the handle? */
export type WatchScope = (handle: WatchHandle) => Promise<boolean>;

async function installationListing(org: string): Promise<Set<string>> {
  const installId = await getInstallationIdForOwner(org).catch(() => null);
  if (!installId) return new Set();
  try {
    const { repos } = await listInstallationReposResult(installId);
    return new Set(repos.map((r) => r.fullName.toLowerCase()));
  } catch (err) {
    console.warn(
      `[watch-scope] ${org}: installation listing unavailable, admitting only the org's own namespace`,
      err instanceof Error ? err.message : err,
    );
    return new Set();
  }
}

/**
 * The org's watch scope for one request. Build it once and ask it per repo: the installation listing
 * is fetched at most once, and only when a name outside the org's own namespace is asked about.
 */
export function watchScopeFor(orgSlug: string): WatchScope {
  if (selfHosted()) return async () => true;
  const org = orgSlug.trim().toLowerCase();
  let listing: Promise<Set<string>> | null = null;
  return async (handle) => {
    if (handle.owner.toLowerCase() === org) return true;
    listing ??= installationListing(org);
    return (await listing).has(handle.fullName.toLowerCase());
  };
}
