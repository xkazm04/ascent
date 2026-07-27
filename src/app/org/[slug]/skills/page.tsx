import { SkillsPanel } from "@/components/org/skills/SkillsPanel";
import { ApiTokensPanel } from "@/components/org/skills/ApiTokensPanel";
import {
  getCreditState,
  getOrgRollup,
  getOrgSkillAdoption,
  listOrgApiTokens,
  listOrgSkills,
  SKILL_TOKEN_SCOPES,
  workspaceAllowsSkills,
} from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";
import { getOrgSkillUsage } from "@/lib/org/skill-usage";
import { getOrgSkillOutcomes } from "@/lib/org/skill-outcomes";

export const dynamic = "force-dynamic";

export default async function OrgSkills({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Read access is enforced by the org layout; here we resolve the plan + role to gate authoring/archive.
  // usage/outcomes are the drift-loop half: is each skill still used (dormancy), and did adopting it
  // move the adopting repo's score. Both degrade to {} rather than failing the catalog render.
  const [skills, adoption, usage, outcomes, rollup, credit, isMember, isAdmin] = await Promise.all([
    listOrgSkills(slug),
    getOrgSkillAdoption(slug),
    getOrgSkillUsage(slug).catch(() => ({})),
    getOrgSkillOutcomes(slug).catch(() => ({})),
    getOrgRollup(slug),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
  ]);
  // Team+ orgs, or a personal workspace (individual tier: free-with-limits authoring).
  const planAllowed = await workspaceAllowsSkills(slug, credit?.plan);
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
        usage={usage}
        outcomes={outcomes}
        repoOptions={repoOptions}
        canAuthor={isMember && planAllowed}
        isAdmin={isAdmin}
        planAllowed={planAllowed}
      />
      {isMember && <ApiTokensPanel slug={slug} initial={tokens} scopes={SKILL_TOKEN_SCOPES} />}
    </div>
  );
}
