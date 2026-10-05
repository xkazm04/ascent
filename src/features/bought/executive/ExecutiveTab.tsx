// Org dashboard "Briefing" tab (id: executive). SERVER component, filename PINNED.
// The theme picks the composition after the reads: ExecutiveTab.v1 (Altimeter) or ExecutiveTab.v2 (Prism).
// Both receive the same ExecutiveView. The public share page does not come through here.

import { buildExecBriefing, briefingMarkdown } from "@/lib/org/briefing";
import { SectionEmpty } from "@/components/org/shared/ui";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding } from "@/lib/db";
import { getOrgImpactLedger } from "@/lib/db/org-impact";
import { getOrgProgram } from "@/lib/db/org-program";
import { resolveStackScope } from "@/lib/org/scope";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { hasOrgRole } from "@/lib/authz";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
import { getTheme } from "@/lib/theme/server";
import { executiveV1 } from "./ExecutiveTab.v1";
import { executiveV2, executiveEmptyV2 } from "./ExecutiveTab.v2";
import type { ExecutiveView } from "./executiveView";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ExecutiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const period = await resolveOrgWindow(sp);
  const segmentId = typeof sp.segment === "string" ? sp.segment : null;
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [briefing, theme] = await Promise.all([
    buildExecBriefing(slug, orgWindowBounds(period), period.title, segmentId, techGroupId),
    getTheme(),
  ]);

  if (!briefing) {
    return theme === "prism" ? (
      executiveEmptyV2()
    ) : (
      <SectionEmpty>
        No scanned repositories yet. Scan some of this org&apos;s repos to generate an executive briefing.
      </SectionEmpty>
    );
  }

  // One ownership check feeds sharing and white-label. Impact and the program are independent reads.
  const [impact, program, isOwner] = await Promise.all([
    getOrgImpactLedger(slug, orgWindowBounds(period)).catch(() => null),
    getOrgProgram(slug).catch(() => null),
    hasOrgRole(slug, "owner"),
  ]);
  const canShare = briefingShareEnabled() && isOwner;
  const [branding, credit] = isOwner
    ? await Promise.all([getOrgBranding(slug).catch(() => null), getCreditState(slug).catch(() => null)])
    : [null, null];
  const canBrand = isOwner && planAllowsWhiteLabel(credit?.plan);

  const view: ExecutiveView = {
    slug, period, segmentId, techGroups, activeStack, briefing,
    md: briefingMarkdown(briefing),
    impact, program, canShare, branding, canBrand,
  };
  return theme === "prism" ? executiveV2(view) : executiveV1(view);
}
