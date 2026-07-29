// Org dashboard "Skills" tab — the browsable Skills Library plus the member-only API tokens panel.
//
// SERVER component: the shell is client-side, this tab keeps reading the database directly behind the
// layout's canReadOrg gate. Filename PINNED as SkillsTab.tsx; it takes `slug` as a prop, because it is
// no longer a route and cannot await route params itself.
//
// `isMember` is resolved ONCE and the PROMISE handed to both regions (the catalog's Promise.all needs it
// to decide whether to fetch tokens inline for the old behavior's parity, and the tokens region needs it
// to gate its own read) — same shared-promise pattern as OverviewTab's `resolveOrgScope`.
//
// Two independent data sources, two <Suspense> boundaries: the catalog (skills/adoption/usage/outcomes/
// rollup/credit) is the tab's one real cost; the tokens list is cheap but member-gated and irrelevant to
// most viewers, so it also code-splits via SkillsTabChunks + <Defer> rather than shipping in the initial
// client bundle.

import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { SkillsPanel } from "@/components/org/library/skills/SkillsPanel";
import { ApiTokensPanelChunk } from "@/components/org/library/skills/SkillsTabChunks";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
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
import { getOrgSkillUsage } from "@/lib/org/skill-usage-load";
import { getOrgSkillOutcomes } from "@/lib/org/skill-outcomes-load";

async function SkillsLibraryData({ slug, isMember }: { slug: string; isMember: Promise<boolean> }) {
  // usage/outcomes are the drift-loop half: is each skill still used (dormancy), and did adopting it
  // move the adopting repo's score. Both degrade to {} rather than failing the catalog render.
  const [skills, adoption, usage, outcomes, rollup, credit, member, isAdmin] = await Promise.all([
    listOrgSkills(slug),
    getOrgSkillAdoption(slug),
    getOrgSkillUsage(slug).catch(() => ({})),
    getOrgSkillOutcomes(slug).catch(() => ({})),
    getOrgRollup(slug),
    getCreditState(slug).catch(() => null),
    isMember,
    hasOrgRole(slug, "admin"),
  ]);
  // Team+ orgs, or a personal workspace (individual tier: free-with-limits authoring).
  const planAllowed = await workspaceAllowsSkills(slug, credit?.plan);
  const repoOptions = (rollup?.repos ?? []).map((r) => r.fullName).sort();

  return (
    <SkillsPanel
      slug={slug}
      initial={skills ?? []}
      categories={SKILL_CATEGORIES}
      adoption={adoption}
      usage={usage}
      outcomes={outcomes}
      repoOptions={repoOptions}
      canAuthor={member && planAllowed}
      isAdmin={isAdmin}
      planAllowed={planAllowed}
    />
  );
}

async function SkillsApiTokensData({ slug, isMember }: { slug: string; isMember: Promise<boolean> }) {
  // Tokens are a member capability (machine access to the library) — only fetch/render for members.
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

  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <SkillsLibraryData slug={slug} isMember={isMember} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[14rem]" />}>
        <SkillsApiTokensData slug={slug} isMember={isMember} />
      </Suspense>
    </div>
  );
}
