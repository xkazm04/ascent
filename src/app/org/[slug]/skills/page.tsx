import { SkillsPanel } from "@/components/org/skills/SkillsPanel";
import { ApiTokensPanel } from "@/components/org/skills/ApiTokensPanel";
import { getCreditState, getOrgRollup, getOrgSkillAdoption, listOrgApiTokens, listOrgSkills, SKILL_TOKEN_SCOPES } from "@/lib/db";
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
  // Tokens are a member capability (machine access to the library) — only fetch/render for members.
  const tokens = isMember ? await listOrgApiTokens(slug) : [];

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
      {isMember && <ApiTokensPanel slug={slug} initial={tokens} scopes={SKILL_TOKEN_SCOPES} />}
    </div>
  );
}
