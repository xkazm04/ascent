// Org dashboard "Settings" tab — org-level configuration (§8.5): BYOM providers, the model
// scorecard, owner-only retention/compaction, and on-demand data erasure. SERVER component, filename PINNED
// (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example).
//
// OWNER GATE, preserved exactly as the old route: the check runs FIRST, before any card is built or
// rendered, and a non-owner gets nothing but the "Owner only" empty state — no card, not even a
// disabled one. DataErasureCard and RetentionCard are owner-only by absence; a pinned test
// (SettingsTab.test.tsx) asserts the non-owner render contains no `/erase/i` or `/retention/i`.
// Do not move this check behind any card render.
//
// Its old route (src/app/org/[slug]/settings/page.tsx) is now a redirect().

import { LlmProviderSettings } from "./LlmProviderSettings";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";
import { ModelScorecard } from "./ModelScorecard";
import { BYOM_ANCHOR } from "./modelScorecardViz";
import { ProviderBoundaryCard } from "./ProviderBoundaryCard";
import { DataErasureCard } from "./DataErasureCard";
import { RetentionCard } from "./RetentionCard";
import { OrgEmpty, SectionHeader } from "@/components/org/shared/ui";
import { getCreditState, getOrgLlmConfig } from "@/lib/db";
import { getOrgRetention } from "@/lib/db/retention";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { orgTabHref } from "@/lib/org/orgTabs";

export async function SettingsTab({ slug }: { slug: string }) {
  if (!(await hasOrgRole(slug, "owner"))) {
    return <OrgEmpty title="Owner only" body="Organization settings are available to organization owners." href={orgTabHref(slug, "overview")} cta="← Overview" />;
  }
  const [config, credit, retention] = await Promise.all([
    getOrgLlmConfig(slug),
    getCreditState(slug).catch(() => null),
    getOrgRetention(slug).catch(() => null),
  ]);

  const planAllowed = planAllowsByom(credit?.plan);

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" description="Owner only" />
      {/* First sight is graphical (§2.2): the boundary/billing/plan comparison the two BYOM cards
          below used to carry as a paragraph each, drawn once, above both. */}
      <ProviderBoundaryCard config={config} planAllowed={planAllowed} />
      <LlmProviderSettings
        slug={slug}
        initial={config}
        planAllowed={planAllowed}
        encryptionConfigured={isEncryptionConfigured()}
      />
      {/* The scorecard's "Use ↑" links land here — the slugs it ranks are OpenRouter slugs. The anchor
          is owned by the tab rather than the card so the card stays reusable and unaware of it. */}
      <div id={BYOM_ANCHOR} className="scroll-mt-24">
        <OpenRouterByomSettings
          slug={slug}
          initial={config}
          planAllowed={planAllowed}
          encryptionConfigured={isEncryptionConfigured()}
        />
      </div>
      <ModelScorecard />
      {/* Retention then erasure: both owner-gated above, so a non-owner never renders either control
          (rather than seeing them disabled). Save on RetentionCard never purges. */}
      <RetentionCard slug={slug} initial={retention} />
      <DataErasureCard slug={slug} />
    </div>
  );
}
