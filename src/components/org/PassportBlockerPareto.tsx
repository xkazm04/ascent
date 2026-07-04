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

import { useState } from "react";
import { PassportBlockerShell } from "@/components/org/PassportBlockerShell";
import { CreateIssueModal, type IssueDraft } from "@/components/github/CreateIssueModal";
import { AXIS_TONE, aggregateBlockers, type Agg } from "@/components/org/passportBlockerAgg";
import type { PassportRow } from "@/components/org/PassportTable";
import { reportPermalink } from "@/lib/ui";

const MAX_MARKS = 20;

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

  return (
    <PassportBlockerShell scopeLabel={scopeLabel} intro="Each mark is a blocked repo — click a row to file it as GitHub issues." empty={top.length === 0}>
      <div className="mt-3 space-y-1">
        {top.map((a) => {
          const tone = AXIS_TONE[a.axis];
          const marks = a.repos.slice(0, MAX_MARKS);
          return (
            <div key={a.label} className="border-l-2 pl-3" style={{ borderColor: `${tone.color}66` }}>
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
                  </span>
                  <span className="font-mono text-sm tabular-nums text-slate-300">{a.repos.length}</span>
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
