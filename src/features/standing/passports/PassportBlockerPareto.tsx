"use client";

// Fleet blocker docket (P3) — the passports' blocker strings aggregated across the repos in view and
// ranked by how many repos each one blocks: "fix this once, move N repos". Message-first, one row per
// blocker: the sentence is the headline, the axis is a colored left hairline, and magnitude renders as
// discrete unit marks — one small square per blocked repo (hover names it) — rather than a continuous
// bar. A row click opens the shared CreateIssueModal pre-filled with the blocker as an issue draft
// (title + markdown body + the affected repos as targets, each footered with its report link), so the
// docket's next step is filing real GitHub issues, gated behind that pop-up. Recomputed from whatever
// rows the active cohort filter leaves visible. Aggregation lives in passportBlockerAgg; the panel
// shell (Surface + Kicker + all-clear) in PassportBlockerShell.
//
// PASSPORT 0.4.0 — A DECLINED GAP STAYS VISIBLE. `aggregateBlockers` stopped letting a decline shrink
// a bucket: an accepted gap is now returned in `declinedRepos` BESIDE the open `repos`, and ranking
// uses the total, so the blocker everybody has accepted no longer looks like the blocker nobody has.
// This row must not re-hide what the aggregation deliberately stopped subtracting — so a declined repo
// gets its own HOLLOW mark next to the solid ones, and its own count. It is deliberately NOT folded
// into the solid run: a solid mark means "open here, fix it"; a hollow one means "this team read it
// and accepted it". The issue draft still targets the open repos only — filing an issue against a repo
// whose owner has already declined the gap is exactly the "present a team's own decision back to them
// as an open finding" failure the aggregation change exists to prevent.

import { useState } from "react";
import { PassportBlockerShell } from "@/features/standing/passports/PassportBlockerShell";
import { CreateIssueModal, type IssueDraft } from "@/components/github/CreateIssueModal";
import { AXIS_TONE, aggregateBlockers, type Agg } from "@/features/standing/passports/passportBlockerAgg";
import type { PassportRow } from "@/features/standing/passports/PassportTable";
import { reportPermalink } from "@/lib/ui";

// Mark budget per row, split across the two populations so a long open run cannot crowd the declined
// marks off the row entirely (they are the smaller, more easily lost population, and they are the
// point of this change). Overflow is implicit: the numeric counts beside the marks are always exact.
const MAX_MARKS = 20;
const MAX_DECLINED_MARKS = 8;

/** The blocker → issue-draft translation: shared title/body, one target per affected repo with its
 *  report permalink as the per-repo footer. Links are absolute (issue bodies live on github.com). */
function draftFor(a: Agg, org: string, scopeLabel: string, inView: number): IssueDraft {
  const origin = window.location.origin;
  return {
    title: a.label.replace(/\.$/, ""),
    context: `${a.axis} blocker · ${a.repos.length}/${inView} repos in view`,
    body: [
      `Ascent flagged a **${a.axis} readiness** blocker on this repository:`,
      ``,
      `> ${a.label}`,
      ``,
      `It affects ${a.repos.length} of the ${inView} repos in the "${scopeLabel}" view of the [${org} fleet passports](${origin}/org/${org}/passports).`,
    ].join("\n"),
    targets: a.repos.map((r) => ({
      name: r.name,
      fullName: r.fullName,
      footer: `Ascent report for this repo: ${origin}${reportPermalink(r.fullName)}`,
    })),
  };
}

export function PassportBlockerPareto({ rows, scopeLabel, org, max = 8 }: { rows: PassportRow[]; scopeLabel: string; org: string; max?: number }) {
  const top = aggregateBlockers(rows).slice(0, max);
  const [draft, setDraft] = useState<IssueDraft | null>(null);

  const anyDeclined = top.some((a) => a.declinedRepos.length > 0);

  return (
    <PassportBlockerShell
      scopeLabel={scopeLabel}
      intro={
        anyDeclined
          ? "Each solid mark is a blocked repo; each hollow one is a repo whose owner has accepted the gap. Click a row to file it as GitHub issues in the blocked repos."
          : "Each mark is a blocked repo. Click a row to file it as GitHub issues."
      }
      empty={top.length === 0}
    >
      <div className="mt-3 space-y-1">
        {top.map((a) => {
          const tone = AXIS_TONE[a.axis];
          const marks = a.repos.slice(0, MAX_MARKS);
          const declinedMarks = a.declinedRepos.slice(0, MAX_DECLINED_MARKS);
          return (
            <div key={a.code} className="border-l-2 pl-3" style={{ borderColor: `${tone.color}66` }}>
              <button
                type="button"
                onClick={() => setDraft(draftFor(a, org, scopeLabel, rows.length))}
                title="File this blocker as GitHub issues in the affected repos"
                className="focus-ring group flex w-full items-baseline gap-3 rounded py-1.5 text-left"
              >
                <p className="min-w-0 flex-1 text-base leading-snug text-slate-200 transition group-hover:text-white">
                  {a.label}
                </p>
                <span className="flex shrink-0 items-center gap-2">
                  <span aria-hidden className="flex max-w-28 flex-wrap justify-end gap-0.5">
                    {marks.map((r) => (
                      <span
                        key={r.fullName}
                        title={r.name}
                        className="h-1.5 w-1.5 rounded-[1px]"
                        style={{ backgroundColor: tone.color, opacity: 0.75 }}
                      />
                    ))}
                    {declinedMarks.map((r) => (
                      <span
                        key={`declined:${r.fullName}`}
                        title={`${r.name} — accepted by choice`}
                        className="h-1.5 w-1.5 rounded-[1px] border"
                        style={{ borderColor: tone.color, opacity: 0.6 }}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-slate-300">{a.repos.length}</span>
                  {a.declinedRepos.length > 0 && (
                    <span
                      title={`${a.declinedRepos.length} repo(s) declined this gap by choice — counted, never subtracted`}
                      className="font-mono text-xs tabular-nums text-slate-500"
                    >
                      +{a.declinedRepos.length} accepted
                    </span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <CreateIssueModal draft={draft} onClose={() => setDraft(null)} />
    </PassportBlockerShell>
  );
}
