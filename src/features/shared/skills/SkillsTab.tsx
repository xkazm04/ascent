// Composition of the Skills tab. Reads and the same Suspense boundaries.
import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { OrgTabGap } from "@/components/shared/dashboard/OrgTabGap";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import {
  getOrgSkillAdoption,
  listOrgApiTokens,
  listOrgRepoNames,
  listOrgSkillsPage,
  SKILL_TOKEN_SCOPES,
} from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";
import { getOrgSkillUsage } from "@/lib/org/skill-usage-load";
import { getOrgSkillOutcomes } from "@/lib/org/skill-outcomes-load";
import { getRegistrySync, registryBlobBase, type RegistrySync } from "@/lib/org/registry-sync";
import { SkillsPanel } from "./SkillsPanel";
import { ApiTokensPanelChunk } from "./SkillsTabChunks";

async function SkillsRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="skills" />;
}

async function SkillsLibraryData({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  const [page, adoption, usage, outcomes, repoOptions, isAdmin] = await Promise.all([
    listOrgSkillsPage(slug),
    getOrgSkillAdoption(slug),
    getOrgSkillUsage(slug).catch(() => ({})),
    getOrgSkillOutcomes(slug).catch(() => ({})),
    listOrgRepoNames(slug),
    hasOrgRole(slug, "admin"),
  ]);
  return (
    <SkillsPanel
      slug={slug}
      initial={page?.skills ?? []}
      initialTruncated={page?.truncated ?? false}
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
      <ApiTokensPanelChunk slug={slug} initial={tokens} scopes={SKILL_TOKEN_SCOPES} />
    </Defer>
  );
}

export async function SkillsTab({ slug }: { slug: string }) {
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
      <NextMoveLink href={orgTabHref(slug, "live")} to="live" />
    </div>
  );
}
