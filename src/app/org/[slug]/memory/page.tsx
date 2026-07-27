import { MemoryPanel } from "@/components/org/MemoryPanel";
import { MemoryCoverageStrip } from "./MemoryCoverageStrip";
import { getMemoryCoverage } from "@/lib/memory/coverage";
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
  const [memories, namespaces, credit, isMember, isAdmin, personal, coverage] = await Promise.all([
    listOrgMemories(slug, {}, viewer),
    listOrgMemoryNamespaces(slug),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
    isPersonalOrg(slug),
    // Coverage is an instrument, not the page: a failed read degrades to honest zeros rather than
    // taking down the memory list it decorates.
    getMemoryCoverage(slug).catch(() => null),
  ]);
  // Team+ orgs, or a personal workspace (individual tier: free-with-limits authoring).
  const planAllowed = planAllowsMemory(credit?.plan) || personal;

  return (
    <div className="space-y-6">
      {coverage && coverage.totalTrackedRepos > 0 && <MemoryCoverageStrip coverage={coverage} />}
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
