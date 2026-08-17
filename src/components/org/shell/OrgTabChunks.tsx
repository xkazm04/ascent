// The tab → panel switch for the org dashboard shell (docs/ORG-TABS-REFACTOR.md).
//
// A SERVER component on purpose. `kp`'s equivalent is a `next/dynamic` client registry because every
// tab there fetches from an API route; ascent's tabs read the database directly behind the layout's
// tenant gate, so they stream as server components instead — the shell's ONE deliberate deviation
// from the reference. Nothing here may become "use client": that would drag every panel across the
// boundary and turn a server render into an HTML → JS → fetch → paint waterfall.
//
// Boundaries: each panel gets its OWN <Suspense> with a quiet reserved-height gap, so a slow tab's
// first byte can't hold the shell — and a tab with several data sources adds further boundaries
// INSIDE itself (see OverviewTab), never here. The error boundary is keyed on the active tab so a
// crash in one panel doesn't survive a switch to another.
//
// Do NOT "simplify" this into a Record<OrgTabId, Component>: `segments` is a sub-view that renders
// the Repositories panel in a different mode, so the switch must be able to map two ids onto one
// component with a differing prop.

import { Suspense } from "react";
import { AuditTab } from "../govern/audit/AuditTab";
import { GovernanceTab } from "../govern/governance/GovernanceTab";
import { MembersTab } from "../govern/members/MembersTab";
import { IntegrationsTab } from "../govern/integrations/IntegrationsTab";
import { SettingsTab } from "../govern/settings/SettingsTab";
import { OverviewTab } from "../overview/OverviewTab";
import { ExecutiveTab } from "../intelligence/executive/ExecutiveTab";
import { LiveTab } from "../intelligence/live/LiveTab";
import { SecurityTab } from "../intelligence/security/SecurityTab";
import { PassportsTab } from "../intelligence/passports/PassportsTab";
import { SkillsTab } from "../library/skills/SkillsTab";
import { MemoryTab } from "../library/memory/MemoryTab";
import { RegistryTab } from "../library/registry/RegistryTab";
import { CareTab } from "../library/care/CareTab";
import { RepositoriesTab } from "../fleet/repositories/RepositoriesTab";
import { TechStacksTab } from "../fleet/tech-stacks/TechStacksTab";
import { TeamsTab } from "../fleet/teams/TeamsTab";
import { ContributorsTab } from "../fleet/contributors/ContributorsTab";
import { AdoptionTab } from "../fleet/adoption/AdoptionTab";
import { DeliveryTab } from "../fleet/delivery/DeliveryTab";
import { PlanTab } from "../plan/PlanTab";
import { BacklogTab } from "../plan/backlog/BacklogTab";
import { PracticesTab } from "../plan/practices/PracticesTab";
import { OrgTabErrorBoundary } from "./OrgTabErrorBoundary";
import { OrgTabGap } from "./OrgTabGap";
import type { OrgTabId } from "@/lib/org/orgTabs";

export type OrgSearchParams = { [key: string]: string | string[] | undefined };

export function OrgTabChunks({ slug, tab, sp }: { slug: string; tab: OrgTabId; sp: OrgSearchParams }) {
  return (
    <OrgTabErrorBoundary resetKey={tab}>
      {/* Keyed on the tab so every panel genuinely unmounts on a switch (no state survives — deep
          links must hydrate from render-time params, never from an effect) and the entrance replays. */}
      <div key={tab} className="animate-fade-in">
        {tab === "overview" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <OverviewTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "audit" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
            <AuditTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "governance" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <GovernanceTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "members" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[24rem]" />}>
            <MembersTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "integrations" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <IntegrationsTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "settings" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <SettingsTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "executive" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
            <ExecutiveTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "live" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <LiveTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "security" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <SecurityTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "passports" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <PassportsTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "skills" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <SkillsTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "memory" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <MemoryTab slug={slug} />
          </Suspense>
        ) : null}

        {/* The customer-owned registry repo: onboarding stepper when unmapped, dashboard once indexed.
            Takes `sp` for the prototype round's `?demo=<state>` fixture switch. */}
        {tab === "registry" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <RegistryTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {/* UC3 "Care": one id, two modes resolved INSIDE the tab (personal vs org) so the shell stays
            ignorant of Organization.kind — same contract as every other panel. */}
        {tab === "care" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <CareTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {/* `segments` and `repositories` both render RepositoriesTab, with the RAW tab id mapped to an
            explicit `mode` prop here — this is the one place that decides what `?tab=segments` means
            (design doc gotcha #6); RepositoriesTab itself never re-reads `sp.tab`. */}
        {tab === "repositories" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
            <RepositoriesTab slug={slug} sp={sp} mode="repositories" />
          </Suspense>
        ) : null}

        {tab === "segments" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <RepositoriesTab slug={slug} sp={sp} mode="segments" />
          </Suspense>
        ) : null}

        {tab === "tech-stacks" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <TechStacksTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "teams" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <TeamsTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "contributors" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <ContributorsTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "adoption" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
            <AdoptionTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "delivery" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
            <DeliveryTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {/* Plan owns its OWN internal <Suspense> boundaries (gap / core / detector backlog — see
            PlanTab), same shape as Overview; it takes no `sp` since none of its panels are scoped by
            a deep-link param. */}
        {tab === "plan" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <PlanTab slug={slug} />
          </Suspense>
        ) : null}

        {tab === "backlog" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
            <BacklogTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {tab === "practices" ? (
          <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
            <PracticesTab slug={slug} sp={sp} />
          </Suspense>
        ) : null}

        {/* The other 6 tabs are still their own routes. A module agent registers one here, adds its
            id to MIGRATED_ORG_TAB_IDS, and turns the old route into a redirect(). Until then
            /org/[slug]/page.tsx redirects an unregistered ?tab= back to the legacy route, so this
            switch can never render blank. */}
      </div>
    </OrgTabErrorBoundary>
  );
}
