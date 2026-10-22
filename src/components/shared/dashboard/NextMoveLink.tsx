// The onward link a tab ends on: one named step to the next stage of the org path of use
// (docs/adr/2026-09-14-org-path-of-use.md, journey B). The label is derived from the stage and tab
// catalogs, so a rename in either shows up here without a call-site edit.
//
// The caller passes `href` AND `to`, and writes the href itself (`orgTabHref(slug, "overview")`).
// That is deliberate: src/lib/org/tab-link-graph.ts counts only literal tab ids, so a link computed
// here from nextMoveFor() would read as a "dynamic" site and never as an edge. The journey test
// (tab-link-graph.test.ts) is what proves the literal the caller wrote is the one nextMoveFor names.
//
// Two rules decide where it goes:
// (A) It is always visible and unscoped. A contextual or filtered link to the same tab (a dim-scoped
//     drill-in, a conditional banner, a detail-panel link) is a second route and never stands in for it.
// (B) "No data yet" (the state where the next stage would be empty too) renders no forward link; its
//     onward move is the stage that fills it (Security and Executive link to `repositories`). A filter or
//     search that empties the view is not that state, and a catalog- or registry-backed tab (Surfaces,
//     Practices, Skills, Memory) never is: both keep the link. A Connect tab is configuration and always
//     shows it, except in an unavailable state (no database, owner-only, role refusal).
// Live keeps its link in every view (the wall is a view of the Apply entry tab, so it does not depend on
// `?view`); only TV mode, which fullscreens <html>, hides it (LiveNextMove.tsx).
//
// Server-safe: links only, no hooks.

import Link from "next/link";
import { stageOf } from "@/lib/org/orgJourney";
import { orgTabLabel, type OrgTabId } from "@/lib/org/orgTabs";

export function NextMoveLink({ href, to }: { href: string; to: OrgTabId }) {
  const stage = stageOf(to);
  const label = `Next: ${stage ? `${stage.label} - ` : ""}${orgTabLabel(to)}`;
  return (
    <nav aria-label="Next move" className="flex justify-end">
      <Link href={href} className="focus-ring type-caption text-accent transition hover:text-white">
        {label} →
      </Link>
    </nav>
  );
}
