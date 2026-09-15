// What the week did to the follow-up ledger: the drawing first, the named rows under it as evidence.
//
// The two columns are NOT symmetric, and the asymmetry is the honest part. "Closed" is an event —
// a RecommendationEvent status change inside the window — so every closed row can name when and how
// (a rescan resolved it, or a person did). "Opened" has no creation event to read: it is a derived
// identity diff between the pre-window scan and the latest one, so a repo with no earlier scan
// cannot contribute to it at all.
//
// Both of those used to be sentences above the panel. `DigestLedgerBars` draws them: the dismissed
// segment sits beside the closes across a visible gap, and an unmeasurable "opened" is a void that
// structurally cannot print a 0. What is left here is the frame, the legend rows that carry the
// counts those marks deliberately do not print, and the row-level evidence.

import Link from "next/link";
import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { Legend, StateSwatch, type LegendExtra } from "@/components/org/viz";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { DigestFollowupRow, WeeklyDigest } from "@/lib/org/digest-types";
import { DigestLedgerBars } from "./DigestLedgerBars";
import { ledgerView } from "./digestViz";

const DISMISSED_HINT =
  "Counted beside the closes and never folded into them: a dismissal is a decision not to do the work, " +
  "and an update that adds it to the closes is claiming credit for it.";
const NOT_COMPARED_HINT =
  "These repositories had no scan from before the window, so the opened-gap diff could not speak for them. " +
  "They are excluded from the opened count rather than counted as having opened nothing.";
const NO_DIFF_HINT =
  "No repository has a scan from before this week, so there is nothing to diff the latest gaps against. " +
  "This is a history gap, not a quiet week.";

const repos = (n: number): string => `${n} ${n === 1 ? "repository" : "repositories"}`;

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
  if (!followups) {
    return (
      <Card>
        <SectionHeader size="sm" title="Follow-ups this week" />
        <InlineEmpty>Follow-up activity could not be read this week.</InlineEmpty>
      </Card>
    );
  }

  const view = ledgerView(followups);
  const extra: LegendExtra[] = [
    {
      id: "dismissed",
      label: `${followups.dismissed} dismissed`,
      swatch: <StateSwatch state="decided" baseColor="var(--color-divider)" />,
      hint: DISMISSED_HINT,
    },
  ];
  if (!view.openedMeasurable) {
    extra.push({ id: "no-diff", label: "opened: no measurement", swatch: <StateSwatch state="missing" />, hint: NO_DIFF_HINT });
  } else if (view.unmeasuredRepos > 0) {
    extra.push({
      id: "not-compared",
      label: `${repos(view.unmeasuredRepos)} not compared`,
      swatch: <StateSwatch state="not-judged" />,
      hint: NOT_COMPARED_HINT,
    });
  }

  return (
    <Card>
      <SectionHeader size="sm" title="Follow-ups this week" />
      <div className="mt-3">
        <DigestLedgerBars view={view} />
      </div>
      <Legend className="mt-3" states={["measured"]} extra={extra} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Kicker tone="muted">Closed · {followups.closed}</Kicker>
          {followups.closedRows.map((r) => (
            <Row key={`${r.repo}:${r.dimId}:${r.title}`} row={r} />
          ))}
          <MoreLink slug={slug} count={followups.closed} shown={followups.closedRows.length} />
        </div>
        <div className="space-y-1.5">
          <Kicker tone="muted">Opened{view.openedMeasurable ? ` · ${followups.opened}` : ""}</Kicker>
          {view.openedMeasurable ? (
            <>
              {followups.openedRows.map((r) => (
                <Row key={`${r.repo}:${r.dimId}:${r.title}`} row={r} />
              ))}
              <MoreLink slug={slug} count={followups.opened} shown={followups.openedRows.length} />
            </>
          ) : (
            // (O) The column's own zero state — where the reader has no marks to read and genuinely
            // needs the reason. The same sentence rides the pasted markdown, which has no legend.
            <p className="type-body-sm text-slate-500">
              Not measurable this week: no repository had a scan before the window opened, so there is nothing to
              diff the latest gaps against.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
