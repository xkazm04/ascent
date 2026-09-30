// The reads both the library and Recall/Reflect need, started once per tab and shared as a promise.
// Viewer stays a promise so the namespace list (viewer-scoped) does not serialize ahead of the reads
// that do not need a login. Team+ orgs, or a personal workspace, may write.
import { getCreditState, isPersonalOrg, listOrgMemoryNamespaces } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsMemory } from "@/lib/plans";

export interface MemoryShared {
  namespaces: string[];
  isMember: boolean;
  isAdmin: boolean;
  planAllowed: boolean;
  personal: boolean;
}

export async function resolveMemoryShared(slug: string, viewer: Promise<string | null>): Promise<MemoryShared> {
  const [namespaces, credit, isMember, isAdmin, personal] = await Promise.all([
    viewer.then((v) => listOrgMemoryNamespaces(slug, v)),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
    isPersonalOrg(slug),
  ]);
  const planAllowed = planAllowsMemory(credit?.plan) || personal;
  return { namespaces, isMember, isAdmin, planAllowed, personal };
}
