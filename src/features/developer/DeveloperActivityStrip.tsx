// The Developer route's git-side half: the signed-in developer's OWN slice of the org's contributor
// snapshot (docs/REGISTRY-AND-CARE-IMPL.md §5.4). Unfloored, because the champion floors in
// `champions.ts` exist to stop the ORG reading a person — not to stop a person reading themself.
//
// `view.activity` is null for FOUR unrelated reasons and this component used to say all four with
// one paragraph ("…yet — or the workspace has too few contributors…"). `view.activityState` now
// names which one, and each leads with its own mark: a suppression is hatched (the numbers exist and
// were withheld), an absence is a void (there is nothing to withhold). Reading "you have never
// committed here" to someone whose row was suppressed is the worst thing this page could do.

import { Kicker } from "@/components/ui";
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { StateSwatch } from "@/components/org/viz";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { orgTabHref } from "@/lib/org/orgTabs";
import { timeAgo } from "@/lib/ui";
import { CareShareBar } from "./CareShareBar";
import type { CareActivityState, DeveloperView } from "@/lib/org/developer-view";

/** The empty/degraded states — where a reader has no picture and genuinely needs the sentence. */
function ActivityAbsence({ state, login }: { state: CareActivityState; login: string | null }) {
  const mark = state === "absent" || state === "signed-out" ? "missing" : "not-judged";
  const body =
    state === "withheld" ? (
      <>
        Withheld: this workspace has fewer than {CHAMPION_MIN_POP} contributors, so the snapshot suppresses{" "}
        <em>every</em> per-person row — including your own. Your commits exist; they are not being handed to a
        page that could name one or two people.
      </>
    ) : state === "unreadable" ? (
      <>The contributor snapshot could not be read just now, so nothing here is a measurement of you.</>
    ) : state === "signed-out" ? (
      <>Sign in and this reads your own commits, AI-attributed share and the gaps of the repos you touch.</>
    ) : (
      <>
        No commits attributed to <span className="font-mono text-slate-300">{login}</span> in this workspace&apos;s
        scanned repositories. Scanning a repository you commit to fills this in.
      </>
    );

  return (
    <div className="mt-3 flex gap-3 rounded-xl border border-slate-800 bg-slate-900/20 px-4 py-4">
      <StateSwatch state={mark} className="mt-0.5" />
      <p className="max-w-2xl type-body-sm text-slate-400">{body}</p>
    </div>
  );
}

export function DeveloperActivityStrip({ view, slug }: { view: DeveloperView; slug: string }) {
  const a = view.activity;
  if (!a) return <ActivityAbsence state={view.activityState} login={view.login} />;

  // A share needs a denominator. With no commits there is nothing to take a share OF, and the bar
  // draws the void rather than an empty track that would read as a measured zero.
  const measurable = a.commits > 0;

  return (
    <div className="mt-3 space-y-4">
      <div className="rounded-xl border border-divider bg-ink px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <Kicker tone="muted">AI-attributed share of your commits</Kicker>
          {measurable && <span className="font-mono type-title font-bold tabular-nums text-white">{a.aiShare}%</span>}
        </div>
        <div className="mt-2">
          <CareShareBar commits={a.commits} aiCommits={a.aiCommits} share={a.aiShare} />
        </div>
        {measurable && (
          <Kicker tone="muted" className="mt-2">
            {a.aiCommits} of {a.commits} commits · {a.repos} {a.repos === 1 ? "repo" : "repos"}
          </Kicker>
        )}
      </div>

      <div className={TILE_GRID}>
        <Tile label="Commits" value={a.commits} sub={`across ${a.repos} ${a.repos === 1 ? "repo" : "repos"}`} />
        <Tile label="AI-attributed" value={a.aiCommits} sub="of your commits carry an AI trailer" />
        <Tile
          label="Last active"
          value={a.lastActiveAt ? timeAgo(a.lastActiveAt) : "—"}
          sub={a.lastActiveAt ? "newest commit in a scanned repo" : "no dated commit in the snapshot"}
        />
        <Tile
          label="AI champion"
          value={a.champion ? "★" : "—"}
          sub={a.champion ? "named in this org's champions cohort" : "not in this org's champions cohort"}
          href={orgTabHref(slug, "contributors")}
        />
      </div>
    </div>
  );
}
