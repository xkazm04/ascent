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
// THEME DUALITY: after the gate and the reads, the theme picks the composition (SettingsTab.v1.tsx Altimeter,
// SettingsTab.v2.tsx Prism). Both take the same SettingsData and render the same cards.
//
// Its old route (src/app/org/[slug]/settings/page.tsx) is now a redirect().

import { settingsV1 } from "./SettingsTab.v1";
import { settingsV2 } from "./SettingsTab.v2";
import type { SettingsData } from "./settingsData";
import { OrgEmpty } from "@/components/org/shared/ui";
import { getCreditState, getOrgLlmConfig } from "@/lib/db";
import { getOrgRetention } from "@/lib/db/retention";
import { hasOrgRole } from "@/lib/authz";
import { planAllowsByom } from "@/lib/plans";
import { isEncryptionConfigured } from "@/lib/crypto/secret-box";
import { orgTabHref } from "@/lib/org/orgTabs";
import { envBool } from "@/lib/env";
import { getTheme } from "@/lib/theme/server";
import { polarEnabled } from "@/lib/polar";
import { loadLaneRouting } from "@/lib/llm/lane-routes-load";

export async function SettingsTab({ slug }: { slug: string }) {
  if (!(await hasOrgRole(slug, "owner"))) {
    return <OrgEmpty title="Owner only" body="Organization settings are available to organization owners." href={orgTabHref(slug, "overview")} cta="← Overview" />;
  }
  const configRead = getOrgLlmConfig(slug);
  const [config, credit, retention, laneRouting, theme] = await Promise.all([
    configRead,
    getCreditState(slug).catch(() => null),
    getOrgRetention(slug).catch(() => null),
    // Where each LLM lane runs for this org, plus the "if switched on" preview of a saved provider.
    // Never throws: an unreadable state renders as "could not be read", not as a platform guess.
    configRead.then((c) => loadLaneRouting(slug, c)),
    getTheme(),
  ]);
  const data: SettingsData = {
    slug,
    config,
    retention,
    laneRouting,
    plan: credit?.plan ?? "free",
    planAllowed: planAllowsByom(credit?.plan),
    planChangesEnabled: envBool("ASCENT_ALLOW_PLAN_CHANGES"),
    portalEnabled: polarEnabled(),
    encryptionConfigured: isEncryptionConfigured(),
  };
  return theme === "prism" ? settingsV2(data) : settingsV1(data);
}
