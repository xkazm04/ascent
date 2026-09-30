// The Prism (v2) composition of the leaderboard region. Same data as v1 (the panel resolves it once); what
// changes is the structure: a masthead states the fleet (the one dominant element), posture filters are a
// Segmented nav (a non-hue channel: label plus count, no status dot), scope and export sit on one toolbar, and the
// list is ruled RepoRows in a Frame rather than a boxed table.
import type { ReactNode } from "react";
import { Frame, GhostAction, Masthead, Segmented, Toolbar, VoidMark } from "@/components/kit";
import { POSTURE_ORDER, postureLabel } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { RepoLeaderboard } from "./RepoLeaderboard";
import { fleetActivity } from "./repoFleetModel";
import type { LeaderRow, SegmentItem } from "./useRepoLeaderboard";
import type { OrgRollup } from "@/lib/db/org-rollup";
import type { OrgScope } from "@/lib/org/scope";

export function RepositoriesViewV2({
  slug,
  rollup,
  leaderboard,
  visible,
  posture,
  postureCounts,
  chipHref,
  csvHref,
  scope,
  schedulable,
  missing,
  queue,
}: {
  slug: string;
  rollup: OrgRollup;
  leaderboard: LeaderRow[];
  visible: LeaderRow[];
  posture: string | null;
  postureCounts: Map<string, number>;
  chipHref: (p: string | null) => string;
  csvHref: string;
  scope: OrgScope;
  schedulable: boolean;
  missing: ReactNode;
  queue: ReactNode;
}) {
  const act = fleetActivity(leaderboard);
  const avg = rollup.avgOverall;
  const filtered = posture != null;
  const options = [
    { key: "all", label: `All ${leaderboard.length}`, href: chipHref(null) },
    ...POSTURE_ORDER.filter((p) => (postureCounts.get(p) ?? 0) > 0).map((p) => ({ key: p, label: `${postureLabel(p)} ${postureCounts.get(p)}`, href: chipHref(p) })),
  ];
  return (
    <div className="space-y-8">
      <Masthead
        pattern="grid"
        eyebrow="Repositories"
        statement="The fleet holds"
        named={`${rollup.repoCount} ${rollup.repoCount === 1 ? "repository" : "repositories"}`}
        lede={filtered ? `${visible.length} of ${rollup.repoCount} shown, ${postureLabel(posture)} posture.` : `${rollup.scannedCount} of ${rollup.repoCount} scanned. Activity covers about four weeks.`}
        figures={[
          {
            label: "Average score",
            value: avg == null ? <VoidMark subject="Average score" size={20} /> : avg,
            detail: avg == null ? "No live score yet" : `${rollup.realScoredCount} live-scored${rollup.mockCount > 0 ? `, ${rollup.mockCount} mock excluded` : ""}`,
          },
          { label: "Commits, 4 weeks", value: act ? act.commits.toLocaleString() : <VoidMark subject="Commits" size={20} />, detail: act ? `${act.measured} of ${leaderboard.length} repos read` : "No activity read" },
          { label: "Merged PRs", value: act ? act.prsMerged.toLocaleString() : <VoidMark subject="Merged PRs" size={20} />, detail: act ? "analyzed PR window" : "No activity read" },
        ]}
      />
      <Frame edge="top" pad="md" aria-label="Repository leaderboard">
        <Toolbar
          className="mb-3"
          left={<Segmented nav label="Filter by posture" value={posture ?? "all"} options={options} />}
          right={
            <ScopeFilterBar {...scope.barProps}>
              <GhostAction href={csvHref} aria-label={filtered || scope.activeStack ? "Export the filtered repos as CSV" : "Export the full fleet as CSV"}>
                Export CSV
              </GhostAction>
            </ScopeFilterBar>
          }
        />
        <div className="mb-4">{queue}</div>
        {missing}
        <RepoLeaderboard slug={slug} rows={visible} segments={scope.segments as SegmentItem[]} schedulable={schedulable} theme="prism" />
      </Frame>
    </div>
  );
}
