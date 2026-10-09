// Altimeter composition of the Skills tab. Markup moved unchanged from SkillsTab.
// Prism is SkillsTab.v2. Filename of the ENTRY stays SkillsTab.tsx.

import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { SkillsPanel } from "@/features/shared/skills/SkillsPanel";
import { ApiTokensPanelChunk } from "@/features/shared/skills/SkillsTabChunks";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
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
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";

/** The registry strip: one small read, its own boundary, and it never blocks the catalog. */
async function SkillsRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="skills" />;
}

async function SkillsLibraryData({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  // usage/outcomes are the drift-loop half: is each skill still used (dormancy), and did adopting it
  // move the adopting repo's score. Both degrade to {} rather than failing the catalog render.
  const [page, adoption, usage, outcomes, repoOptions, isAdmin] = await Promise.all([
    listOrgSkillsPage(slug),
    getOrgSkillAdoption(slug),
    getOrgSkillUsage(slug).catch(() => ({})),
    getOrgSkillOutcomes(slug).catch(() => ({})),
    // One column, one query: the catalog reads repo NAMES, not a fleet rollup (see listOrgRepoNames).
    listOrgRepoNames(slug),
    hasOrgRole(slug, "admin"),
  ]);
  // Awaiting the SHARED promise a second time does not re-query (same pattern as `isMember` below).
  const registryBase = registryBlobBase(await sync);

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
      registryBase={registryBase}
    />
  );
}

async function SkillsApiTokensData({ slug, isMember }: { slug: string; isMember: Promise<boolean> }) {
  // Tokens are a member capability (machine access to the library). Only fetch/render for members.
  const member = await isMember;
  if (!member) return null;
  const tokens = await listOrgApiTokens(slug);
  return (
    <Defer strategy="idle">
      <ApiTokensPanelChunk slug={slug} initial={tokens} scopes={SKILL_TOKEN_SCOPES} />
    </Defer>
  );
}

export async function SkillsTabV1({ slug }: { slug: string }) {
  const isMember = hasOrgRole(slug, "member");
  // NOT awaited here. The one promise streams into the strip AND the catalog (see MemoryTab's note).
  const sync = getRegistrySync(slug);

  return (
    <div className="stagger-children space-y-6">
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
