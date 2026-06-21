import { SkillsPanel } from "@/components/org/SkillsPanel";
import { getCreditState, getOrgRollup, getOrgSkillAdoption, listOrgSkills } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsSkillsLibrary } from "@/lib/plans";
import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";

export const dynamic = "force-dynamic";

export default async function OrgSkills({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read access is enforced by the org layout; here we resolve the plan + role to gate authoring/archive.
  const [skills, adoption, rollup, credit, isMember, isAdmin] = await Promise.all([
    listOrgSkills(slug),
    getOrgSkillAdoption(slug),
    getOrgRollup(slug),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
  ]);
  const planAllowed = planAllowsSkillsLibrary(credit?.plan);
  const repoOptions = (rollup?.repos ?? []).map((r) => r.fullName).sort();

  return (
    <div className="space-y-6">
      <SkillsPanel
        slug={slug}
        initial={skills ?? []}
        categories={SKILL_CATEGORIES}
        adoption={adoption}
        repoOptions={repoOptions}
        canAuthor={isMember && planAllowed}
        isAdmin={isAdmin}
        planAllowed={planAllowed}
      />
    </div>
  );
}
