// The tab -> panel lookup for the org dashboard shell (docs/ORG-TABS-REFACTOR.md). The panels
// themselves live in ./orgTabPanels, a map exhaustive over `OrgPanelTabId`.
//
// A SERVER component on purpose. `kp`'s equivalent is a `next/dynamic` client registry because every
// tab there fetches from an API route; ascent's tabs read the database directly behind the layout's
// tenant gate, so they stream as server components instead - the shell's ONE deliberate deviation
// from the reference. Nothing here may become "use client".
//
// Boundaries: each panel gets its OWN <Suspense> with a quiet reserved-height gap, so a slow tab's
// first byte can't hold the shell - and a tab with several data sources adds further boundaries
// INSIDE itself (see OverviewTab), never here. The error boundary is keyed on the active tab so a
// crash in one panel doesn't survive a switch to another.

import { Suspense } from "react";
import { OrgTabErrorBoundary } from "./OrgTabErrorBoundary";
import { OrgTabGap } from "../../shared/dashboard/OrgTabGap";
import { ORG_TAB_PANELS, type OrgSearchParams } from "./orgTabPanels";
import type { OrgPanelTabId } from "@/lib/org/orgTabs";

export type { OrgSearchParams } from "./orgTabPanels";

export function OrgTabChunks({ slug, tab, sp }: { slug: string; tab: OrgPanelTabId; sp: OrgSearchParams }) {
  const panel = ORG_TAB_PANELS[tab];
  return (
    <OrgTabErrorBoundary resetKey={tab}>
      {/* Keyed on the tab so every panel genuinely unmounts on a switch (no state survives - deep
          links must hydrate from render-time params, never from an effect) and the entrance replays. */}
      <div key={tab} className="animate-fade-in">
        <Suspense fallback={<OrgTabGap minH={panel.minH} />}>{panel.render(slug, sp)}</Suspense>
      </div>
    </OrgTabErrorBoundary>
  );
}
