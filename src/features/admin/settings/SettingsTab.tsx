// Org dashboard "Settings" tab — org-level configuration (§8.5): BYOM providers, the model
// scorecard, and (owner-only) on-demand data erasure. SERVER component, filename PINNED
// (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example).
//
// OWNER GATE, preserved exactly as the old route: the check runs FIRST, before any card is built or
// rendered, and a non-owner gets nothing but the "Owner only" empty state — no card, not even a
// disabled one. DataErasureCard's own doc comment calls this "owner-only by absence"; a pinned test
// (SettingsTab.test.tsx) asserts the non-owner render contains no `/erase/i` anywhere. Do not move
// this check behind any card render.
//
// Its old route (src/app/org/[slug]/settings/page.tsx) is now a redirect().

import { LlmProviderSettings } from "./LlmProviderSettings";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";
import { ModelScorecard } from "./ModelScorecard";
import { DataErasureCard } from "./DataErasureCard";
import { OrgEmpty, SectionHeader } from "@/components/org/shared/ui";
import { getCreditState, getOrgLlmConfig } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { orgTabHref } from "@/lib/org/orgTabs";

export async function SettingsTab({ slug }: { slug: string }) {
  if (!(await hasOrgRole(slug, "owner"))) {
    return <OrgEmpty title="Owner only" body="Organization settings are available to organization owners." href={orgTabHref(slug, "overview")} cta="← Overview" />;
  }
  const [config, credit] = await Promise.all([getOrgLlmConfig(slug), getCreditState(slug).catch(() => null)]);

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" description="Organization configuration (owner only)." />
      <LlmProviderSettings
        slug={slug}
        initial={config}
        planAllowed={planAllowsByom(credit?.plan)}
        encryptionConfigured={isEncryptionConfigured()}
      />
      <OpenRouterByomSettings
        slug={slug}
        initial={config}
        planAllowed={planAllowsByom(credit?.plan)}
        encryptionConfigured={isEncryptionConfigured()}
      />
      <ModelScorecard />
      {/* Compliance actions last, and only here: the tab is owner-gated above, so a non-owner never
          renders this control at all (rather than seeing it disabled). */}
      <DataErasureCard slug={slug} />
    </div>
  );
}
