// The governance tab's single data-bearing region: resolves scope, builds the fleet gate overview,
// and hands the same props to whichever composition the theme selected. One panel, one Suspense
// boundary (GovernanceTab): every card derives from the same `buildGovernanceOverview` read.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { buildGovernanceOverview } from "@/lib/org/governance";
import { resolveOrgScope } from "@/lib/org/scope";
import { hasOrgRole } from "@/lib/authz";
import type { ThemeId } from "@/lib/theme/theme";
import { GovernanceViewV1 } from "./GovernanceView.v1";
import { GovernanceViewV2 } from "./GovernanceView.v2";
import type { GovernanceSearchParams } from "./governanceView";

export async function GovernancePanel({
  slug,
  sp,
  theme,
}: {
  slug: string;
  sp: GovernanceSearchParams;
  theme: ThemeId;
}) {
  // Segment + tech-stack scope (?segment=/?stack=). The scope narrows WHO is measured; the policy
  // stays org-wide.
  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  const scoped = segmentId != null || techGroupId != null;

  // Owners can edit the persisted gate policy (GATE-1); everyone sees the active policy read-only.
  // The overview hands back the policy row it already read, so this does not issue a second fetch.
  const [g, canEdit] = await Promise.all([
    buildGovernanceOverview(slug, segmentId, techGroupId),
    hasOrgRole(slug, "owner"),
  ]);

  const props = {
    slug,
    sp,
    g,
    canEdit,
    scoped,
    filterBar: <ScopeFilterBar {...barProps} />,
  };
  return theme === "prism" ? <GovernanceViewV2 {...props} /> : <GovernanceViewV1 {...props} />;
}
