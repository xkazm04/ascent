// ChampionsCard — the culture carriers, with the follow-up the old list lacked: what a champion is FOR
// (seeding patterns in low-AI teams) and the jump to the full contributor detail. Server-safe.

import Link from "next/link";
import { Card, InlineEmpty, Meter, SectionHeader } from "@/components/org/ui";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { scoreHex } from "@/lib/ui";

export function ChampionsCard({
  champions,
  totalContributors,
  slug,
}: {
  champions: AdoptionOverview["champions"];
  totalContributors: number;
  slug: string;
}) {
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="AI champions"
        description="Culture carriers — high AI adoption across real volume. A champion's approach is a pattern others can borrow."
        right={
          <Link href={`/org/${slug}/contributors`} className="shrink-0 font-mono text-xs uppercase tracking-widest text-slate-500 transition hover:text-accent">
            Contributors →
          </Link>
        }
      />
      {totalContributors < CHAMPION_MIN_POP ? (
        // Same small-population guard as the Contributors tab: below the floor, one AI user reads as a
        // celebrated "#1" — a ranking, not a culture signal. Suppress consistently across tabs.
        <InlineEmpty>Too few contributors to surface champions without it reading as a ranking.</InlineEmpty>
      ) : champions.length === 0 ? (
        <InlineEmpty>No AI-attributed contributors yet.</InlineEmpty>
      ) : (
        <div className="mt-3 space-y-1.5">
          {champions.map((c) => (
            <div key={c.login} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 truncate font-mono text-slate-200" title={`${c.login} — ${c.repos} repo${c.repos === 1 ? "" : "s"}`}>
                {c.login}
              </span>
              <Meter className="flex-1" value={c.aiShare} color={scoreHex(c.aiShare)} />
              <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">
                {c.aiShare}% · {c.aiCommits}/{c.commits}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
