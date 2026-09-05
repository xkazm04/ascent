// WHICH ORGANIZATION'S STATE GOVERNS THIS REPOSITORY — the tenancy question the gate asks before it
// reads an org-scoped bar for `owner/repo`.
//
// THE DEFECT THIS CLOSES is the one `repoUnderOrg` was already fixed for (see `orgTracksRepo`, and
// org-intelligence.md's "an org named for its team could never admit its own repos"): both gate
// surfaces resolved org-scoped state by the GITHUB OWNER LOGIN. `getOrgGatePolicy(owner)` and
// `resolveAdmissionLayer(owner, …)` therefore found nothing for an org whose slug is not its owner
// namespace — an org named for the team, watching repos under a personal or differently-named
// account. Finding nothing is indistinguishable from "no bar configured", so the gate went green on
// the archetype default while the owner's dashboard showed a bar it believed was being enforced.
//
// THE FACT WE RESOLVE THROUGH is the same one `orgTracksRepo` uses: the `Repository` row keyed
// `(orgId, fullName)` IS the statement that this org has this repository. Not `watched`, which is a
// rescan-cadence preference and answers a different question.
//
// AND IT REFUSES TO GUESS. A public repository can legitimately appear under several orgs at once —
// the shared PUBLIC_ORG holds every anonymously-scanned repo's series, and a personal workspace holds
// watch-pointer rows. Those two are LENSES over public data, never governance tenants, so they are
// excluded outright. If more than one real tenant is left, this returns the owner login rather than
// picking one: on an UNAUTHENTICATED endpoint, choosing an arbitrary tenant's policy would let one
// org's bar (or its admission block) decide another caller's verdict. Ambiguity resolves to today's
// behaviour, never to a stranger's bar.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { orgTracksRepo } from "@/lib/db/org-admission";
import { PUBLIC_ORG } from "@/lib/org-constants";

/**
 * The org slug whose persisted gate policy / admission decision governs `repoFullName`.
 *
 * Always returns a slug — the owner login is the fallback, so every caller keeps working exactly as
 * before when there is no database, no tracking org, or an ambiguous set. Never throws for a
 * legitimate absence; a genuine read failure propagates, because a caller that folds an org bar must
 * treat "could not determine the tenant" as "could not read the bar" (both gate surfaces already
 * fail closed on that).
 *
 * @param ownerLogin  the repository's owner namespace, already normalized (lower-cased).
 * @param repoFullName the coordinate a `Repository` row is keyed by (`owner/name`, or the
 *                     forge-namespaced `gitlab:group/project`).
 */
export async function orgSlugForRepo(ownerLogin: string, repoFullName: string): Promise<string> {
  if (!isDbConfigured()) return ownerLogin;
  // FAST PATH, and the one that keeps every existing deployment byte-identical: the common case is an
  // org whose slug IS its owner namespace, and this is exactly the check `repoUnderOrg` makes.
  if (await orgTracksRepo(ownerLogin, repoFullName)) return ownerLogin;

  const rows = await getPrisma().repository.findMany({
    where: { fullName: repoFullName },
    select: { org: { select: { slug: true, kind: true } } },
  });
  const tenants = [
    ...new Set(
      rows
        .map((r) => r.org)
        .filter((o): o is { slug: string; kind: string } => Boolean(o) && o.kind !== "personal" && o.slug !== PUBLIC_ORG)
        .map((o) => o.slug),
    ),
  ];
  // Exactly one real tenant tracks it -> that is the governing org. Zero or several -> the owner
  // login, which is what this resolved to before this function existed.
  return tenants.length === 1 ? tenants[0]! : ownerLogin;
}
