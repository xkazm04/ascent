"use client";

// The Developer route's git-side half: the signed-in developer's OWN slice of the org's contributor
// snapshot (docs/REGISTRY-AND-CARE-IMPL.md §5.4). Unfloored, because the champion floors in
// `champions.ts` exist to stop the ORG reading a person — not to stop a person reading themself.
//
// `view.activity` is null when the roster carries no row for this login: they have never committed to
// a scanned repo here, OR the population is under the naming floor and the producer withheld every
// per-person row. Both are stated, never rendered as zeros that would read as "you did nothing".

import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { scoreHex, timeAgo } from "@/lib/ui";
import type { DeveloperView } from "@/lib/org/developer-view";

export function DeveloperActivityStrip({ view, slug }: { view: DeveloperView; slug: string }) {
  const a = view.activity;
  if (!a) {
    return (
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/20 px-4 py-4">
        <p className="max-w-2xl text-sm text-slate-400">
          {view.login
            ? <>No commits attributed to <span className="font-mono text-slate-300">{view.login}</span> in this workspace&apos;s scanned repositories yet — or the workspace has too few contributors for per-person rows to be readable at all. Scanning a repository you commit to fills this in.</>
            : <>Sign in and this reads your own commits, AI-attributed share and the gaps of the repos you touch.</>}
        </p>
      </div>
    );
  }

  return (
    <div className={`mt-3 ${TILE_GRID}`}>
      <Tile label="Commits" value={a.commits} sub={`across ${a.repos} ${a.repos === 1 ? "repo" : "repos"}`} />
      <Tile label="AI-attributed" value={a.aiCommits} sub="of your commits carry an AI trailer" />
      <Tile label="Your AI share" value={`${a.aiShare}%`} sub="commit-weighted, yours alone" color={scoreHex(a.aiShare)} />
      <Tile
        label={a.champion ? "AI champion" : "Last active"}
        value={a.champion ? "★" : timeAgo(a.lastActiveAt ?? undefined)}
        sub={a.champion ? "named in this org's champions cohort" : "newest commit in a scanned repo"}
        href={orgTabHref(slug, "contributors")}
      />
    </div>
  );
}
