// What the week did to the follow-up ledger: what closed, and what opened.
//
// The two columns are NOT symmetric, and the asymmetry is the honest part. "Closed" is an event —
// a RecommendationEvent status change inside the window — so every closed row can name when and how
// (a rescan resolved it, or a person did). "Opened" has no creation event to read: it is a derived
// identity diff between the pre-window scan and the latest one, so a repo with no earlier scan cannot
// contribute to it at all. When NO repo has a pre-window scan the whole column is unmeasurable, and
// it says so in a sentence rather than printing a 0 that would read as "a calm week".
//
// Dismissals are counted BESIDE the closes, never folded in: a dismissed follow-up is a decision not
// to do the work, and a leadership update that adds it to "closed" is claiming credit for it.

import Link from "next/link";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { DigestFollowupRow, WeeklyDigest } from "@/lib/org/digest-types";

function Row({ row }: { row: DigestFollowupRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3 type-body-sm">
      <span className="min-w-0 text-slate-300">
        {row.title} — <span className="type-mono-sm text-slate-400">{row.repo}</span>{" "}
        <span className="text-slate-500">({row.dimId})</span>
      </span>
      {row.how && <span className="shrink-0 type-caption text-slate-500">{row.how === "scan" ? "by rescan" : "by hand"}</span>}
    </div>
  );
}

/** "+N more" into the ledger itself — the digest lists a handful, the ledger owns the full backlog. */
function MoreLink({ slug, count, shown }: { slug: string; count: number; shown: number }) {
  if (count <= shown) return null;
  return (
    <Link
      href={orgTabHref(slug, "followups")}
      className="focus-ring type-body-sm text-slate-400 transition hover:text-accent"
    >
      +{count - shown} more
    </Link>
  );
}

export function DigestFollowups({ slug, followups }: { slug: string; followups: WeeklyDigest["followups"] }) {
  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Follow-ups this week"
        description="What the ledger closed, and what the latest scans opened. Dismissals are counted beside the closes, never folded into them."
      />
      {!followups ? (
        <InlineEmpty>Follow-up activity could not be read this week.</InlineEmpty>
      ) : (
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Kicker tone="muted">Closed · {followups.closed}</Kicker>
            {followups.closedRows.map((r) => (
              <Row key={`${r.repo}:${r.dimId}:${r.title}`} row={r} />
            ))}
            <p className="type-caption text-slate-500">{followups.dismissed} dismissed, not counted as closed</p>
            <MoreLink slug={slug} count={followups.closed} shown={followups.closedRows.length} />
          </div>
          <div className="space-y-1.5">
            <Kicker tone="muted">Opened · {followups.opened}</Kicker>
            {followups.openedMeasurable ? (
              <>
                {followups.openedRows.map((r) => (
                  <Row key={`${r.repo}:${r.dimId}:${r.title}`} row={r} />
                ))}
                {followups.unmeasuredRepos > 0 && (
                  <p className="type-caption text-slate-500">
                    ({followups.unmeasuredRepos} {followups.unmeasuredRepos === 1 ? "repository" : "repositories"} had no earlier scan and are not counted)
                  </p>
                )}
                <MoreLink slug={slug} count={followups.opened} shown={followups.openedRows.length} />
              </>
            ) : (
              <p className="type-body-sm text-slate-500">
                Not measurable this week: no repository had a scan before the window opened, so there is nothing to
                diff the latest gaps against.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
