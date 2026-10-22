// Body of "Your activity here": the share bar as a ruled line and the four counts as a kit StatStrip.
// The absence states (withheld, unreadable, signed-out, absent) are the v1 component unchanged: they carry
// copy a reader needs and a mark that says which kind of absence it is.
import { Caption, StatStrip, StatTile } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { timeAgo } from "@/lib/ui";
import { ActivityAbsence } from "./DeveloperActivityStrip";
import { CareShareBar } from "./CareShareBar";
import type { DeveloperView } from "@/lib/org/developer-view";

export function DeveloperActivityStripView({ view, slug }: { view: DeveloperView; slug: string }) {
  const a = view.activity;
  if (!a) return <ActivityAbsence state={view.activityState} login={view.login} />;
  const measurable = a.commits > 0;
  const repos = `${a.repos} ${a.repos === 1 ? "repo" : "repos"}`;
  return (
    <div className="space-y-6">
      <div className="max-w-xl">
        <div className="flex items-baseline justify-between gap-3">
          <Caption>AI-attributed share of your commits</Caption>
          {measurable && <span className="type-figure tabular-nums text-white">{a.aiShare}%</span>}
        </div>
        <div className="mt-2">
          <CareShareBar commits={a.commits} aiCommits={a.aiCommits} share={a.aiShare} />
        </div>
        {measurable && (
          <Caption className="mt-2 block">
            {a.aiCommits} of {a.commits} commits · {repos}
          </Caption>
        )}
      </div>
      <StatStrip cols={4}>
        <StatTile label="Commits" value={a.commits} sub={`across ${repos}`} />
        <StatTile label="AI-attributed" value={a.aiCommits} sub="of your commits carry an AI trailer" />
        <StatTile
          label="Last active"
          value={a.lastActiveAt ? timeAgo(a.lastActiveAt) : "—"}
          sub={a.lastActiveAt ? "newest commit in a scanned repo" : "no dated commit in the snapshot"}
        />
        <StatTile
          label="AI champion"
          value={a.champion ? "★" : "—"}
          sub={a.champion ? "named in this org's champions cohort" : "not in this org's champions cohort"}
          href={orgTabHref(slug, "contributors")}
        />
      </StatStrip>
    </div>
  );
}
