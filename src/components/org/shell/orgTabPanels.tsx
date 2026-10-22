// The org shell's panel map: one entry per `?tab=` panel id, `satisfies Record<OrgPanelTabId, PanelDef>`
// so a panel id with no entry (or an alias/route id given one) is a tsc error rather than a blank panel.
//
// A SERVER module on purpose - NO "use client". Ascent's tabs read the database directly behind the
// layout's tenant gate and stream as server components; marking this client would drag every panel
// across the boundary and turn a server render into an HTML -> JS -> fetch -> paint waterfall.
//
// A Record of RENDER FUNCTIONS, not of components: `segments` is a sub-view that renders the
// Repositories panel with mode="segments", so two keys map onto one component with a differing prop.
// This is the one place that decides what `?tab=segments` means (design doc gotcha #6);
// RepositoriesTab itself never re-reads `sp.tab`.

import type { ReactNode } from "react";
import { AuditTab } from "@/features/admin/audit/AuditTab";
import { GovernanceTab } from "@/features/standing/governance/GovernanceTab";
import { MembersTab } from "@/features/admin/members/MembersTab";
import { IntegrationsTab } from "@/features/admin/integrations/IntegrationsTab";
import { SettingsTab } from "@/features/admin/settings/SettingsTab";
import { PairingTab } from "@/features/admin/pairing/PairingTab";
import { OverviewTab } from "@/features/standing/overview/OverviewTab";
import { ExecutiveTab } from "@/features/bought/executive/ExecutiveTab";
import { DigestTab } from "@/features/bought/digest/DigestTab";
import { LiveTab } from "@/features/inflight/live/LiveTab";
import { SecurityTab } from "@/features/standing/security/SecurityTab";
import { PassportsTab } from "@/features/standing/passports/PassportsTab";
import { SkillsTab } from "@/features/shared/skills/SkillsTab";
import { MemoryTab } from "@/features/shared/memory/MemoryTab";
import { RegistryTab } from "@/features/shared/registry/RegistryTab";
import { KnowledgeSection } from "@/features/shared/knowledge/KnowledgeSection";
import { RepositoriesTab } from "@/features/standing/repositories/RepositoriesTab";
import { TechStacksTab } from "@/features/standing/tech-stacks/TechStacksTab";
import { TeamsTab } from "@/features/bought/teams/TeamsTab";
import { ContributorsTab } from "@/features/bought/contributors/ContributorsTab";
import { AdoptionTab } from "@/features/standing/adoption/AdoptionTab";
import { DeliveryTab } from "@/features/bought/delivery/DeliveryTab";
import { ProposalsTab } from "@/features/inflight/proposals/ProposalsTab";
import { LessonsTab } from "@/features/inflight/lessons/LessonsTab";
import { PracticesTab } from "@/features/shared/practices/PracticesTab";
import type { OrgPanelTabId } from "@/lib/org/orgTabs";

export type OrgSearchParams = { [key: string]: string | string[] | undefined };

export interface PanelDef {
  /** Reserved height for the panel's quiet Suspense gap, so nothing jumps when it streams in. */
  minH: string;
  render: (slug: string, sp: OrgSearchParams) => ReactNode;
}

export const ORG_TAB_PANELS = {
  overview: { minH: "min-h-[32rem]", render: (slug, sp) => <OverviewTab slug={slug} sp={sp} /> },
  audit: { minH: "min-h-[28rem]", render: (slug) => <AuditTab slug={slug} /> },
  governance: { minH: "min-h-[32rem]", render: (slug, sp) => <GovernanceTab slug={slug} sp={sp} /> },
  members: { minH: "min-h-[24rem]", render: (slug) => <MembersTab slug={slug} /> },
  integrations: { minH: "min-h-[32rem]", render: (slug) => <IntegrationsTab slug={slug} /> },
  settings: { minH: "min-h-[32rem]", render: (slug) => <SettingsTab slug={slug} /> },
  pairing: { minH: "min-h-[32rem]", render: (slug) => <PairingTab slug={slug} /> },
  executive: { minH: "min-h-[40rem]", render: (slug, sp) => <ExecutiveTab slug={slug} sp={sp} /> },
  // The Briefing's fixed-window sibling: the trailing 7 days as a pasteable leadership update. Takes
  // `sp` for shell uniformity only - its window ignores the period selector.
  digest: { minH: "min-h-[36rem]", render: (slug, sp) => <DigestTab slug={slug} sp={sp} /> },
  live: { minH: "min-h-[36rem]", render: (slug, sp) => <LiveTab slug={slug} sp={sp} /> },
  security: { minH: "min-h-[36rem]", render: (slug, sp) => <SecurityTab slug={slug} sp={sp} /> },
  passports: { minH: "min-h-[32rem]", render: (slug, sp) => <PassportsTab slug={slug} sp={sp} /> },
  skills: { minH: "min-h-[36rem]", render: (slug) => <SkillsTab slug={slug} /> },
  memory: { minH: "min-h-[36rem]", render: (slug) => <MemoryTab slug={slug} /> },
  // The customer-owned registry repo: onboarding stepper when unmapped, dashboard once indexed. Takes
  // no `sp` - the shaped example states are a React-state preview, not a URL.
  registry: { minH: "min-h-[36rem]", render: (slug) => <RegistryTab slug={slug} /> },
  // The registry's knowledge lane plus the fleet's standing against it. Reads `?domain=` and
  // `?subject=` (both tab-scoped); `?section=surfaces` swaps in the UI surfaces gallery. The `surfaces`
  // alias is redirected here by the org page, so it never needs a key of its own.
  knowledge: { minH: "min-h-[32rem]", render: (slug, sp) => <KnowledgeSection slug={slug} sp={sp} /> },
  repositories: {
    minH: "min-h-[40rem]",
    render: (slug, sp) => <RepositoriesTab slug={slug} sp={sp} mode="repositories" />,
  },
  segments: { minH: "min-h-[32rem]", render: (slug, sp) => <RepositoriesTab slug={slug} sp={sp} mode="segments" /> },
  "tech-stacks": { minH: "min-h-[32rem]", render: (slug) => <TechStacksTab slug={slug} /> },
  teams: { minH: "min-h-[32rem]", render: (slug, sp) => <TeamsTab slug={slug} sp={sp} /> },
  contributors: { minH: "min-h-[36rem]", render: (slug, sp) => <ContributorsTab slug={slug} sp={sp} /> },
  adoption: { minH: "min-h-[40rem]", render: (slug, sp) => <AdoptionTab slug={slug} sp={sp} /> },
  delivery: { minH: "min-h-[40rem]", render: (slug, sp) => <DeliveryTab slug={slug} sp={sp} /> },
  // In flight -> Proposals: the former Follow-ups ledger merged with the loop's pending proposals
  // (2026-09-15). The `followups` alias is redirected here by the org page.
  proposals: { minH: "min-h-[32rem]", render: (slug, sp) => <ProposalsTab slug={slug} sp={sp} /> },
  // In flight -> Lessons: the loop agents' lesson candidates, split out of the Live cockpit.
  lessons: { minH: "min-h-[24rem]", render: (slug) => <LessonsTab slug={slug} /> },
  practices: { minH: "min-h-[36rem]", render: (slug, sp) => <PracticesTab slug={slug} sp={sp} /> },
} satisfies Record<OrgPanelTabId, PanelDef>;
