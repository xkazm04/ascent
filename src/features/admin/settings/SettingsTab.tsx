// Org dashboard "Settings" tab — org-level configuration (§8.5): BYOM providers, the model
// scorecard, owner-only retention/compaction, and on-demand data erasure. SERVER component, filename PINNED
// (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example).
//
// OWNER GATE, preserved exactly as the old route: the check runs FIRST, before any card is built or
// rendered, and a non-owner gets nothing but the "Owner only" empty state — no card, not even a
// disabled one. DataErasureCard, RetentionCard and PlanControl (Polar "Manage billing") are owner-only
// by absence; a pinned test (SettingsTab.test.tsx) asserts the non-owner render contains no `/erase/i`,
// `/retention/i`, or `/manage billing/i`. Do not move this check behind any card render.
//
// After the gate and the reads, SettingsTab.v2.tsx (Prism) renders the SettingsData cards.
//
// Its old route (src/app/org/[slug]/settings/page.tsx) is now a redirect().

import { settingsV2 } from "./SettingsTab.v2";
import type { SettingsData } from "./settingsData";
import { OrgEmpty } from "@/components/shared/dashboard/ui";
import { getCreditState, getOrgLlmConfig } from "@/lib/db";
import { getOrgRetention } from "@/lib/db/retention";
import { getRetentionReceipt } from "@/lib/db/retention-receipt";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { orgTabHref } from "@/lib/org/orgTabs";
import { envBool } from "@/lib/env";
import { polarEnabled } from "@/lib/polar";
import { loadLaneRouting } from "@/lib/llm/lane-routes-load";
import { PUBLIC_ORG } from "@/lib/org-constants";

export async function SettingsTab({ slug }: { slug: string }) {
  // The shared public org has no owner, yet hasOrgRole("public", "owner") is true for any signed-in viewer
  // (the funnel has no owner to check); the admin routes behind these cards refuse it, so do not offer them.
  if (slug.trim().toLowerCase() === PUBLIC_ORG || !(await hasOrgRole(slug, "owner"))) {
    return <OrgEmpty title="Owner only" body="Organization settings are available to organization owners." href={orgTabHref(slug, "overview")} cta="← Overview" />;
  }
  const configRead = getOrgLlmConfig(slug);
  const [config, credit, retention, retentionReceipt, laneRouting] = await Promise.all([
    configRead,
    getCreditState(slug).catch(() => null),
    getOrgRetention(slug).catch(() => null),
    getRetentionReceipt(slug).catch(() => null),
    // Where each LLM lane runs for this org, plus the "if switched on" preview of a saved provider.
    // Never throws: an unreadable state renders as "could not be read", not as a platform guess.
    configRead.then((c) => loadLaneRouting(slug, c)),
  ]);
  const data: SettingsData = {
    slug,
    config,
    retention,
    retentionReceipt,
    laneRouting,
    plan: credit?.plan ?? "free",
    planAllowed: planAllowsByom(credit?.plan),
    planChangesEnabled: envBool("ASCENT_ALLOW_PLAN_CHANGES"),
    portalEnabled: polarEnabled(),
    encryptionConfigured: isEncryptionConfigured(),
  };
  return settingsV2(data);
}
