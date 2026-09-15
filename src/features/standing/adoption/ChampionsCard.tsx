// ChampionsCard — the culture carriers, with the two absences the old card conflated pulled apart.
//
// Below CHAMPION_MIN_POP the producer WITHHOLDS the list: that is a suppression, not a finding, and
// it used to render as the same muted line as "nobody here has AI-attributed commits yet". The first
// leads with the `not-judged` hatch (we did not judge, and never as passing); the second is a real
// measured zero and leads with the `missing` void. Server-safe.

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { Card, InlineEmpty, MeterRow, SectionHeader } from "@/components/org/shared/ui";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { StateSwatch, WhyChip } from "@/components/org/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { scoreHex } from "@/lib/ui";
import { CHAMPION_HINT } from "./adoptionHints";

export function ChampionsCard({
  champions,
  totalContributors,
  slug,
}: {
  champions: AdoptionOverview["champions"];
  totalContributors: number;
  slug: string;
}) {
  const withheld = totalContributors < CHAMPION_MIN_POP;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="AI champions"
        right={
          <span className="flex shrink-0 items-center gap-2">
            <WhyChip hint={CHAMPION_HINT} label="what a champion is for" align="end" />
            <Link href={orgTabHref(slug, "contributors")} className="type-label tracking-widest text-slate-500 transition hover:text-accent">
              Contributors →
            </Link>
          </span>
        }
      />
      {withheld ? (
        // Same small-population guard as the Contributors tab: below the floor, one AI user reads as a
        // celebrated "#1" — a ranking, not a culture signal. Suppress consistently across tabs, and
        // encode the suppression rather than letting it degrade into a generic "no data".
        <div className="mt-3 flex items-start gap-2">
          <StateSwatch state="not-judged" className="mt-1" />
          <InlineEmpty>
            Withheld: with fewer than {CHAMPION_MIN_POP} contributors, naming a champion identifies one or two people, so this reads as a
            ranking rather than a culture signal.
          </InlineEmpty>
        </div>
      ) : champions.length === 0 ? (
        <div className="mt-3 flex items-start gap-2">
          <StateSwatch state="missing" className="mt-1" />
          <InlineEmpty>No AI-attributed contributors yet.</InlineEmpty>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {champions.map((c) => (
            <MeterRow
              key={c.login}
              layout="labelled"
              label={<span title={`${c.login} (${c.repos} repo${c.repos === 1 ? "" : "s"})`}>{c.login}</span>}
              labelClassName="w-36 shrink-0 truncate font-mono text-slate-200"
              ariaLabel={`${c.login}: ${c.aiShare}% AI-attributed across ${c.commits} commits in ${c.repos} repo${c.repos === 1 ? "" : "s"}`}
              value={c.aiShare}
              display={`${c.aiShare}% · ${c.aiCommits}/${c.commits}`}
              color={scoreHex(c.aiShare)}
              meterClassName="flex-1"
              valueClassName="w-28 shrink-0 text-right type-mono-sm text-slate-400"
            />
          ))}
        </div>
      )}
    </Card>
  );
}
