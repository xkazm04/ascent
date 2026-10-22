// The ONE resolver for which instance of a forge an org's scans read from (card github-data-1).
//
// A self-managed GitLab is connected through an Installation row whose `host` is the instance's web
// root. Before this resolver, that host was honoured for permalinks only: every snapshot and
// enrichment read went to gitlab.com at the same path. `scanRepository` now asks here before it
// builds the source and the enrichment set, so the instance is decided once, from the org, and
// travels with the scan.
//
// Fails CLOSED. A configured host that is not a public https address (private range, loopback,
// link-local, cloud metadata, plain http) is REFUSED, never fetched and never swapped for gitlab.com:
// the host is admin-supplied, and the platform's server would otherwise fetch an internal URL on an
// admin's say-so (SSRF). Allowing an internal-network GitLab on a self-hosted deployment is a
// recorded residue, not a relaxation this resolver makes.
//
// GitHub never consults the table: GHES stays on the `GITHUB_API_URL` env resolution in
// `src/lib/github/host.ts`, which is the single source for it (github-parity.test.ts stays unchanged).

import { getForgeInstallation, hostFromBase } from "@/lib/db/forge-installations";
import { isSafePublicHttpsUrl } from "@/lib/net/ssrf";
import type { ForgeHost, ForgeId } from "@/lib/forge/types";

export type OrgForgeHost = { host?: ForgeHost } | { refused: "host-not-public" };

/** The forges whose instance is set per org through an Installation row. */
const ORG_HOSTED: readonly ForgeId[] = ["gitlab"];

/**
 * The host an org's scans of `forgeId` read from. `{}` means the forge's public host (no org, no
 * installation, or an installation on the public host); `{ refused }` means the configured host is
 * unsafe and the scan must not run. A database failure propagates: guessing gitlab.com on a read
 * error would be exactly the wrong-instance read this resolver exists to prevent.
 */
export async function resolveOrgForgeHost(orgSlug: string | undefined, forgeId: ForgeId): Promise<OrgForgeHost> {
  if (!orgSlug || !ORG_HOSTED.includes(forgeId)) return {};
  const row = await getForgeInstallation(orgSlug, forgeId);
  if (!row?.host) return {};
  if (!isSafePublicHttpsUrl(row.host)) return { refused: "host-not-public" };
  return { host: hostFromBase(row.host) };
}

/** The fixed refusal copy. Names neither the configured host nor the public one. */
export const UNSAFE_FORGE_HOST_MESSAGE =
  "This organization's GitLab host is not a public https address, so the scan was refused. An admin can correct it under Integrations.";
