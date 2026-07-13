import { MemoryPanel } from "@/components/org/MemoryPanel";
import { getCreditState, isPersonalOrg, listOrgMemories, listOrgMemoryNamespaces } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { planAllowsMemory } from "@/lib/plans";
import { MEMORY_KINDS } from "@/lib/org/memory-kinds";

export const dynamic = "force-dynamic";

export default async function OrgMemory({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read access is enforced by the org layout; here we resolve the plan + role to gate writing/archiving.
  // The viewer is resolved FIRST because it scopes the very rows we read (private scratch, §4.5).
  const viewer = await resolveViewerLogin();
  const [memories, namespaces, credit, isMember, isAdmin, personal] = await Promise.all([
    listOrgMemories(slug, {}, viewer),
    listOrgMemoryNamespaces(slug),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
    isPersonalOrg(slug),
  ]);
  // Team+ orgs, or a personal workspace (individual tier: free-with-limits authoring).
  const planAllowed = planAllowsMemory(credit?.plan) || personal;

  return (
    <div className="space-y-6">
      <MemoryPanel
        slug={slug}
        initial={memories ?? []}
        kinds={MEMORY_KINDS}
        namespaces={namespaces}
        viewerLogin={viewer}
        canWrite={isMember && planAllowed}
        isAdmin={isAdmin}
        planAllowed={planAllowed}
        defaultVisibility={personal ? "private" : "shared"}
      />
    </div>
  );
}
