// AI champions — the cohort drawn as a position in adoption × volume space, with the cards below it
// as the named evidence. The population floor is applied by getContributorInsights itself (it returns
// `champions: []` below CHAMPION_MIN_POP), so this renders whatever the producer was willing to name.
//
// The header used to carry the whole ranking rule as a sentence ("Highest AI adoption across the most
// repos, weighted by breadth and activity: exemplars whose approach the team could learn from"). The
// scatter encodes all three variables — y is adoption, x is volume, radius is breadth — and the ★
// rank stays on the card, where it is a label on a thing you can already see.

import { SectionHeader } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { AiBar } from "./AiBar";
import type { ContributorInsights } from "@/lib/db";
import { isViewer, YouMark } from "./ContributorsYouPointer";
import { ChampionScatter } from "./ChampionScatter";

/** The demoted A1 lede: what the ranking is FOR, on demand rather than above the graphic. */
const CHAMPION_HINT =
  "Ranked by AI adoption weighted by breadth and activity — exemplars whose approach the team could " +
  "learn from, not a performance ranking.";

export function ContributorsChampionsGrid({
  champions,
  slug,
  viewerLogin = null,
}: {
  champions: ContributorInsights["champions"];
  slug: string;
  /** §5.2 — when the viewer is one of the champions, their card links across to their own view. */
  viewerLogin?: string | null;
}) {
  return (
    <div className="mt-8">
      <SectionHeader
        title="AI champions"
        right={<WhyChip hint={CHAMPION_HINT} label="what ranks a champion" align="end" />}
      />
      <ChampionScatter
        className="mt-3"
        points={champions.map((c) => ({
          login: c.login,
          aiShare: c.aiShare,
          commits: c.commits,
          repos: c.repos,
          isViewer: isViewer(c.login, viewerLogin),
        }))}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {champions.map((c, i) => (
          <div key={c.login} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-mono type-body text-white" title={c.login}>{c.login}</span>
              <span className="shrink-0 type-mono-sm uppercase tracking-widest text-accent">#{i + 1} ★</span>
            </div>
            {c.name && <div className="type-body-sm text-slate-500">{c.name}</div>}
            {isViewer(c.login, viewerLogin) && (
              <div className="mt-2">
                <YouMark slug={slug} />
              </div>
            )}
            <div className="mt-3"><AiBar pct={c.commits > 0 ? c.aiShare : null} label={`${c.login} AI share`} /></div>
            <div className="mt-2 flex gap-4 type-mono-sm text-slate-400">
              <span>{c.commits} commits</span>
              <span>{c.aiCommits} AI</span>
              <span>{c.repos} repos</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
