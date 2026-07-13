// The personal workspace's Backlog — every recommendation from the watched repos' latest PUBLIC
// scans, tracked with the VIEWER's private overlay (status + due date). The shared corpus is
// read-only here: an individual working through someone else's repo roadmap marks progress for
// themselves without touching what any org (or other individual) sees. See src/lib/db/personal-backlog.ts.

import Link from "next/link";
import { Card, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { STATUS_ACCENT, STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { OverlayDueDate, OverlayStatusSelect } from "@/components/org/PersonalBacklogControls";
import { getPersonalBacklog, type PersonalBacklogItem } from "@/lib/db";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId, RecStatus } from "@/lib/types";

function ItemRow({ item }: { item: PersonalBacklogItem }) {
  const key = { repo: item.repoFullName, dimId: item.dimId, title: item.title };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 py-3 last:border-b-0">
      <div className="min-w-56 flex-1">
        <span className={item.status === "done" || item.status === "dismissed" ? "text-slate-500 line-through" : "text-slate-200"}>
          {item.title}
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-sm text-slate-500">
          <span>{DIMENSION_SHORT[item.dimId as DimensionId] ?? item.dimId}</span>
          <span title="Impact">impact {item.impact}</span>
          <span title="Effort">effort {item.effort}</span>
          {item.levelUnlock && <span className="text-accent">unlocks {item.levelUnlock}</span>}
        </div>
      </div>
      <OverlayStatusSelect item={key} status={item.status} />
      <OverlayDueDate item={key} targetDate={item.targetDate} />
    </li>
  );
}

function CountChip({ status, count }: { status: RecStatus; count: number }) {
  return (
    <span
      className="rounded-full border px-2.5 py-1 font-mono text-sm tabular-nums"
      style={{ borderColor: `${STATUS_ACCENT[status]}66`, color: STATUS_ACCENT[status] }}
    >
      {STATUS_LABEL[status]} · {count}
    </span>
  );
}

export async function PersonalBacklog({ slug }: { slug: string }) {
  const backlog = await getPersonalBacklog(slug);
  if (!backlog || backlog.total === 0) {
    return (
      <SectionEmpty>
        No recommendations to track yet. Track a public repository on your overview and scan it — its
        roadmap shows up here for you to work through.
      </SectionEmpty>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        className="mb-4"
        descriptionClassName="max-w-3xl"
        title="Your backlog"
        description="Every recommendation from your tracked repos' latest scans. Status and due dates are yours alone — they never change what the repo's other watchers or its org see, and they survive re-scans."
        right={
          <span className="flex flex-wrap items-center gap-2">
            {(["open", "in_progress", "done", "dismissed"] as RecStatus[]).map((s) => (
              <CountChip key={s} status={s} count={backlog.counts[s]} />
            ))}
          </span>
        }
      />
      {backlog.repos.map((repo) => (
        <Card key={repo.fullName}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={`/report/${repo.owner}/${repo.name}?tab=roadmap`}
              className="focus-ring rounded font-medium text-slate-200 hover:text-white"
            >
              {repo.fullName}
            </Link>
            <span className="font-mono text-sm text-slate-500">
              from the scan on {repo.scannedAt.slice(0, 10)}
            </span>
          </div>
          <ul className="mt-2">
            {repo.items.map((item) => (
              <ItemRow key={`${item.dimId}:${item.title}`} item={item} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
