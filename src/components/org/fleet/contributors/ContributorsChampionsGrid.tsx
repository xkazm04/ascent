// AI champions leaderboard — exemplars whose adoption the team could learn from. The population floor
// is applied by getContributorInsights itself (it returns `champions: []` below CHAMPION_MIN_POP), so
// this renders whatever the producer was willing to name — there is nothing left to gate here.
// Extracted out of the old page.tsx body (docs/ORG-TABS-REFACTOR.md) into its own named file — it was
// a private inline helper, now a real sibling component.

import { SectionHeader } from "@/components/org/shared/ui";
import { AiBar } from "./AiBar";
import type { ContributorInsights } from "@/lib/db";

export function ContributorsChampionsGrid({ champions }: { champions: ContributorInsights["champions"] }) {
  return (
    <div className="mt-8">
      <SectionHeader
        title="AI champions"
        description="Highest AI adoption across the most repos, weighted by breadth and activity — exemplars whose approach the team could learn from."
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {champions.map((c, i) => (
          <div key={c.login} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-base text-white" title={c.login}>{c.login}</span>
              <span className="shrink-0 font-mono text-sm uppercase tracking-widest text-accent">#{i + 1} ★</span>
            </div>
            {c.name && <div className="text-sm text-slate-500">{c.name}</div>}
            <div className="mt-3"><AiBar pct={c.aiShare} /></div>
            <div className="mt-2 flex gap-4 font-mono text-sm text-slate-400">
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
