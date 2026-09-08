// The Contributors tab's FIRST SIGHT (§2.2): the spread of AI-authored share across the team, with
// the viewer's own position marked.
//
// This replaces the lede that used to open the tab — "Inputs to explore where trust in AI could grow
// across the team: who's leaning in, whose approach others could learn from, and where key-person
// risk sits." A reader met that sentence before they met a single number. The box IS that reading:
// where the team sits, how wide the spread is, and (the §5.2 pointer, drawn rather than offered) where
// the reader themself falls inside it.
//
// Server-safe: `Distribution` is the client component, everything here is data shaping.

import { Kicker } from "@/components/ui";
import { Distribution, StateSwatch, WhyChip, stateTitle } from "@/components/org/viz";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import type { ContributorInsights } from "@/lib/db";
import { quantiles } from "./contributorStats";
import { isViewer } from "./ContributorsYouPointer";

/** The caveat the strip's shape cannot carry on its own, demoted out of the tab's old lede. */
const READING_HINT =
  "Inputs to explore where trust in AI could grow — who is leaning in, and where key-person risk sits. " +
  "Never a ranking, never directives, and not a to-do list for anyone.";

export function ContributorsAdoptionStrip({
  insights,
  viewerLogin = null,
}: {
  insights: ContributorInsights;
  viewerLogin?: string | null;
}) {
  // Per-person rows are withheld below the naming floor, so there is nothing to spread. Say WHICH
  // absence this is with the void mark itself rather than plotting a box over an empty array.
  const five = quantiles(insights.contributors.map((c) => c.aiShare));
  const me = insights.contributors.find((c) => isViewer(c.login, viewerLogin));

  return (
    <div className="mt-6 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker tone="muted">AI-authored share per contributor</Kicker>
        <WhyChip hint={READING_HINT} label="how to read this" align="end" />
      </div>
      {five ? (
        <Distribution
          className="mt-2"
          min={five.min}
          q1={five.q1}
          median={five.median}
          q3={five.q3}
          max={five.max}
          n={five.n}
          you={me ? me.aiShare : null}
          label="AI-authored share per contributor"
          unit="%"
          digits={0}
        />
      ) : (
        <div className="mt-3 flex items-center gap-2" title={stateTitle("missing", "per-contributor AI share")}>
          <StateSwatch state="missing" />
          <span className="type-body-sm text-slate-500">
            {insights.namingAllowed
              ? "Too few contributors with attributed commits to spread"
              : `Per-person spread withheld below ${CHAMPION_MIN_POP} contributors`}
          </span>
        </div>
      )}
    </div>
  );
}
