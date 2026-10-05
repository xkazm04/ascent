// The onward link a tab ends on: one named step to the next stage of the org path of use
// (docs/adr/2026-09-14-org-path-of-use.md, journey B). The label is derived from the stage and tab
// catalogs, so a rename in either shows up here without a call-site edit.
//
// The caller passes `href` AND `to`, and writes the href itself (`orgTabHref(slug, "overview")`).
// That is deliberate: src/lib/org/tab-link-graph.ts counts only literal tab ids, so a link computed
// here from nextMoveFor() would read as a "dynamic" site and never as an edge. The journey test
// (tab-link-graph.test.ts) is what proves the literal the caller wrote is the one nextMoveFor names.
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
