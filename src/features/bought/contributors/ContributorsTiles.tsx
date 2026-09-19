// The Contributors tab's summary tile band — extracted from ContributorsInsightsPanel so that file
// stays under the 200-LOC cap for src/features (AGENTS.md). Pure relocation: same tiles, same
// naming-floor branches, same deep links. Server-safe (no hooks, no handlers).

import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { ContributorInsights } from "@/lib/db";

/** Each tile deep-links to its evidence section (the Teams tab's tile pattern), so the warn-colored
 *  key-person stat jumps straight to the concentration table + decisions. */
export function ContributorsTiles({ insights }: { insights: ContributorInsights }) {
  return (
    <div className={`mt-6 ${TILE_GRID}`}>
      <Tile label="Contributors" value={insights.totalContributors} sub="humans, recent activity" href="#individuals" />
      {/* Below the naming floor a percentage is the wrong unit: "100% AI-active" for a two-person
          org is one person, stated as a fleet-wide claim (and colored green as if it were an
          achievement). Show the raw count instead — same information, no false confidence. */}
      {insights.namingAllowed ? (
        <Tile label="AI-active" value={`${insights.aiActiveShare}%`} sub={`${insights.aiActive} use AI-attributed commits`} color={scoreHex(insights.aiActiveShare)} href="#individuals" />
      ) : (
        <Tile label="AI-active" value={`${insights.aiActive}/${insights.totalContributors}`} sub="too few contributors to read as a rate" />
      )}
      {insights.namingAllowed ? (
        <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted across the fleet" color={scoreHex(insights.orgAiShare)} />
      ) : (
        <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted (a very small sample)" />
      )}
      <Tile label="Solo-maintainer repos" value={insights.soloMaintainerCount} sub="1 author or ≥80% concentration" color={insights.soloMaintainerCount > 0 ? "var(--color-warn)" : undefined} href="#concentration" />
    </div>
  );
}
