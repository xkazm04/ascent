// What can ascent ACTUALLY do for this viewer against this org's registry?
//
// This is the module the UI reads to decide whether to RENDER a GitHub action at all
// (docs/REGISTRY-AND-CARE-IMPL.md §0b.5). A dead "Create repository" button that 403s on click is
// worse than no button: it teaches the user the product is broken. So every capability here is
// resolved from a real precondition — the App's env, a live installation row, the viewer's membership
// role, the installation's granted permissions — and the UI hides what comes back false.
//
// FAILS CLOSED by construction: every probe is wrapped, and any error resolves to `false` with a
// reason, never to an optimistic `true`.

import { appInstallUrl, createAppJwt, githubAppFetch, isAppConfigured } from "@/lib/github/app";
import { canMintInstallationToken, hasOrgRole } from "@/lib/authz";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { isDbConfigured } from "@/lib/db/client";

/** Why an action is unavailable. `null` when everything needed is present. */
export type RegistryCapabilityReason =
  | "persistence-off"
  | "app-not-configured"
  | "not-installed"
  | "insufficient-role"
  | "token-not-mintable";

export interface RegistryCapabilities {
  /** GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY are set on this deployment. */
  appConfigured: boolean;
  /** The org has a live GitHub App installation ascent can act through. */
  installed: boolean;
  /** ascent can mint an installation token AND the viewer clears the role floor (admin by default).
   *  The gate for "map / scaffold", "re-index" and "open a migration PR". */
  canWrite: boolean;
  /** The installation additionally granted `administration: write`, so ascent can CREATE the
   *  `<org>/ai-registry` repo rather than only map an existing one. */
  canCreateRepo: boolean;
  /** First unmet precondition, for the honest empty state. `null` when `canWrite` is true. */
  reason: RegistryCapabilityReason | null;
  /** Where to send the user to install/configure the App — only set when it would help. */
  installUrl: string | null;
}

const DENIED = (reason: RegistryCapabilityReason, partial: Partial<RegistryCapabilities> = {}): RegistryCapabilities => ({
  appConfigured: false,
  installed: false,
  canWrite: false,
  canCreateRepo: false,
  reason,
  installUrl: null,
  ...partial,
});

/** Installation permission probes are stable for the life of an installation; a short TTL keeps the
 *  tab render from adding a GitHub round-trip per paint without ever serving a stale grant for long. */
const permCache = new Map<string, { admin: boolean; at: number }>();
const PERM_TTL_MS = 60_000;

/**
 * May ascent CREATE a repo through this installation? Two conditions, both necessary:
 *  • the installation grants `administration: write`, and
 *  • the account is an ORGANIZATION — `POST /orgs/{org}/repos` is the only creation endpoint an
 *    installation token can reach; a user account needs a user-to-server token, so the UI must offer
 *    "map an existing repo" there instead of a button that cannot work.
 */
async function canAdminister(installationId: string): Promise<boolean> {
  const hit = permCache.get(installationId);
  if (hit && Date.now() - hit.at < PERM_TTL_MS) return hit.admin;
  try {
    const info = await githubAppFetch<{ permissions?: Record<string, string>; account?: { type?: string } | null }>(
      `/app/installations/${installationId}`,
      createAppJwt(),
    );
    const admin = info.permissions?.administration === "write" && info.account?.type === "Organization";
    permCache.set(installationId, { admin, at: Date.now() });
    return admin;
  } catch {
    // A failed probe is NOT a grant. Mapping an existing repo still works; only the create path hides.
    return false;
  }
}

/** Test seam — drops the memoized installation-permission probes. */
export function resetRegistryCapabilityCache(): void {
  permCache.clear();
}

/**
 * Resolve what the current request's viewer may do with `slug`'s registry.
 *
 * `opts.minRole` is the membership floor for a write. It defaults to `admin` and the UI's flags are
 * resolved at that floor DELIBERATELY: mapping a registry, creating a repo and opening a migration PR
 * all act on the customer's GitHub org, so the tab must not render a control a member would be 403'd
 * on. (The re-index route passes `member` — it only re-reads what is already public to the org.)
 * `opts.probeCreate: false` skips the `administration: write` round-trip when the caller only needs
 * the write gate.
 */
export async function getRegistryCapabilities(
  slug: string,
  opts: { minRole?: "owner" | "admin" | "member" | "viewer"; probeCreate?: boolean } = {},
): Promise<RegistryCapabilities> {
  const installUrl = appInstallUrl();
  if (!isDbConfigured()) return DENIED("persistence-off");
  if (!isAppConfigured()) return DENIED("app-not-configured");

  const installationId = await getInstallationIdForOwner(slug).catch(() => null);
  if (!installationId) return DENIED("not-installed", { appConfigured: true, installUrl });

  const base = { appConfigured: true, installed: true, installUrl };

  // Membership BEFORE token minting: an unauthorized viewer must never cause a token mint attempt.
  if (!(await hasOrgRole(slug, opts.minRole ?? "admin").catch(() => false))) {
    return DENIED("insufficient-role", base);
  }
  if (!(await canMintInstallationToken(slug).catch(() => false))) {
    return DENIED("token-not-mintable", base);
  }

  const canCreateRepo = opts.probeCreate === false ? false : await canAdminister(installationId);
  return { ...base, canWrite: true, canCreateRepo, reason: null };
}
