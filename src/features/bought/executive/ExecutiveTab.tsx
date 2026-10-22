// Org dashboard "Briefing" tab (id: executive). SERVER component, filename PINNED.
// ExecutiveTabView composes the ExecutiveView after the reads. The public share page does not come through here.

import { buildExecBriefing, briefingMarkdown } from "@/lib/org/briefing";
import { briefingShareEnabled } from "@/lib/briefing-share";
import { getCreditState, getOrgBranding } from "@/lib/db";
import { getOrgImpactLedger } from "@/lib/db/org-impact";
import { getOrgProgram } from "@/lib/db/org-program";
import { resolveStackScope } from "@/lib/org/scope";
import { degradedRead } from "@/lib/org/degraded-read";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { hasOrgRole } from "@/lib/authz";
import { orgWindowBounds, resolveOrgWindow } from "@/lib/org/period";
import { executiveView, executiveEmptyView } from "./ExecutiveTabView";
import type { ExecutiveView } from "./executiveView";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ExecutiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const period = await resolveOrgWindow(sp);
  const segmentId = typeof sp.segment === "string" ? sp.segment : null;
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const briefing = await buildExecBriefing(slug, orgWindowBounds(period), period.title, segmentId, techGroupId);

  if (!briefing) return executiveEmptyView(slug);

  // One ownership check feeds sharing and white-label. Impact and the program are independent reads.
  const [impact, program, isOwner] = await Promise.all([
    getOrgImpactLedger(slug, orgWindowBounds(period)).catch(degradedRead("briefing tab impact ledger", null)),
    getOrgProgram(slug).catch(degradedRead("briefing tab program", null)),
    hasOrgRole(slug, "owner"),
  ]);
  const canShare = briefingShareEnabled() && isOwner;
  const [branding, credit] = isOwner
    ? await Promise.all([getOrgBranding(slug).catch(degradedRead("briefing tab branding", null)), getCreditState(slug).catch(degradedRead("briefing tab credit state", null))])
    : [null, null];
  const canBrand = isOwner && planAllowsWhiteLabel(credit?.plan);

  const view: ExecutiveView = {
    slug, period, segmentId, techGroups, activeStack, briefing,
    md: briefingMarkdown(briefing),
    impact, program, canShare, branding, canBrand,
  };
  return executiveView(view);
}
