// Prism composition of the Skills tab. Same reads and the same Suspense boundaries as Altimeter.
import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import {
  getOrgSkillAdoption,
  listOrgApiTokens,
  listOrgRepoNames,
  listOrgSkills,
  SKILL_TOKEN_SCOPES,
} from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";
import { getOrgSkillUsage } from "@/lib/org/skill-usage-load";
import { getOrgSkillOutcomes } from "@/lib/org/skill-outcomes-load";
import { getRegistrySync, registryBlobBase, type RegistrySync } from "@/lib/org/registry-sync";
import { SkillsPanelV2 } from "./SkillsPanel.v2";
import { ApiTokensPanelV2Chunk } from "./SkillsTabChunks.v2";

async function SkillsRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="skills" />;
}

async function SkillsLibraryData({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  const [skills, adoption, usage, outcomes, repoOptions, isAdmin] = await Promise.all([
    listOrgSkills(slug),
    getOrgSkillAdoption(slug),
    getOrgSkillUsage(slug).catch(() => ({})),
    getOrgSkillOutcomes(slug).catch(() => ({})),
    listOrgRepoNames(slug),
    hasOrgRole(slug, "admin"),
  ]);
  return (
    <SkillsPanelV2
      slug={slug}
      initial={skills ?? []}
      categories={SKILL_CATEGORIES}
      adoption={adoption}
      usage={usage}
      outcomes={outcomes}
      repoOptions={repoOptions}
      isAdmin={isAdmin}
      registryBase={registryBlobBase(await sync)}
    />
  );
}

async function SkillsApiTokensData({ slug, isMember }: { slug: string; isMember: Promise<boolean> }) {
  const member = await isMember;
  if (!member) return null;
  const tokens = await listOrgApiTokens(slug);
  return (
    <Defer strategy="idle">
      <ApiTokensPanelV2Chunk slug={slug} initial={tokens} scopes={SKILL_TOKEN_SCOPES} />
    </Defer>
  );
}

export async function SkillsTabV2({ slug }: { slug: string }) {
  const isMember = hasOrgRole(slug, "member");
  const sync = getRegistrySync(slug);
  return (
    <div data-role="skills-v2" className="space-y-2">
      <Suspense fallback={null}>
        <SkillsRegistryStrip slug={slug} sync={sync} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <SkillsLibraryData slug={slug} sync={sync} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[14rem]" />}>
        <SkillsApiTokensData slug={slug} isMember={isMember} />
      </Suspense>
    </div>
  );
}
