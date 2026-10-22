// The Prism masthead's headline figures for the Contributors tab, shaped from the insights the panel
// already read (the same four numbers ContributorsTiles shows in Altimeter, same naming-floor branches).
// Pure: no React, no DB. Below the naming floor a percentage is the wrong unit, so the count stays a count.

import type { MastheadFigure } from "@/components/kit";
import type { ContributorInsights } from "@/lib/db";

export function contributorFigures(insights: ContributorInsights): MastheadFigure[] {
  const floor = insights.namingAllowed;
  return [
    { label: "Contributors", value: insights.totalContributors, detail: "humans, recent activity" },
    floor
      ? { label: "AI-active", value: `${insights.aiActiveShare}%`, detail: `${insights.aiActive} use AI-attributed commits` }
      : { label: "AI-active", value: `${insights.aiActive}/${insights.totalContributors}`, detail: "too few contributors to read as a rate" },
    {
      label: "Org AI commit share",
      value: `${insights.orgAiShare}%`,
      detail: floor ? "commit-weighted across the fleet" : "commit-weighted (a very small sample)",
    },
    {
      label: "Solo-maintainer repos",
      value: insights.soloMaintainerCount,
      tone: insights.soloMaintainerCount > 0 ? "watch" : undefined,
      detail: "1 author or at least 80% concentration",
    },
  ];
}
