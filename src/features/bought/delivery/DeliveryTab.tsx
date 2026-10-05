// Org dashboard "Delivery" tab — PR signals, branch governance, commit activity and the AI delivery
// ROI/governance read. Migrated from src/app/org/[slug]/delivery/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as DeliveryTab.tsx. No auth work — the org layout's canReadOrg
// gate already ran. `resolveOrgScope` + `resolveOrgWindow` are each called ONCE and the promises
// handed to both regions below (the OverviewTab pattern) — awaiting a promise twice does not re-run
// the query. The theme picks the composition: DeliveryTab.v1.tsx (Altimeter, unchanged) or
// DeliveryTab.v2.tsx (Prism). Both keep the four suspense boundaries and pass the same period.

import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { getTheme } from "@/lib/theme/server";
import { DeliveryTabV1 } from "./DeliveryTab.v1";
import { DeliveryTabV2 } from "./DeliveryTab.v2";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function DeliveryTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet) so a leader can read
  // delivery/governance for one business unit or stack; the two filters compose. Deliberately NOT
  // awaited here — see the note at the top of the file.
  const scope = resolveOrgScope(slug, sp);
  // G7-09: the trend needs a period. Resolved through the SHARED org-window helper (URL `?range=`,
  // then the remembered-period cookie, then the default) so picking "30 days" on the Overview carries
  // into Delivery instead of each tab inventing its own range.
  const [period, theme] = await Promise.all([resolveOrgWindow(sp), getTheme()]);
  const props = { slug, scope, period };
  return (
    <>
      {theme === "prism" ? <DeliveryTabV2 {...props} /> : <DeliveryTabV1 {...props} />}
      <NextMoveLink href={orgTabHref(slug, "overview")} to="overview" />
    </>
  );
}
