"use client";

// Prism blocker docket. Same aggregation, same issue draft, same three marks. The axis is a word,
// and the marks are paper: a hue no longer says automation versus production.
import { useState } from "react";
import { CreateIssueModal, type IssueDraft } from "@/components/github/CreateIssueModal";
import { Caption, HairlineList } from "@/components/kit";
import { Legend, WhyChip, type LegendExtra } from "@/components/org/viz";
import type { DecisionMap } from "@/lib/org/decision-map";
import { draftFor } from "./blockerDraft";
import { aggregateBlockers, scopeCounts } from "./passportBlockerAgg";
import { PLACEHOLDER_LABEL, PLACEHOLDER_TITLE } from "./PlaceholderMark";
import { RANK_HINT } from "./PassportBlockerPareto";
import type { PassportRow } from "./PassportTable";

const MAX_MARKS = 20;
const MAX_SIDE = 8;

const legend = (declined: boolean, decided: boolean): LegendExtra[] => [
  {
    id: "open",
    label: "blocked",
    swatch: <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-slate-300" />,
    hint: "One solid mark per repository where this blocker is open. Click the row to file it as GitHub issues in those repos.",
  },
  ...(declined
    ? [{
        id: "accepted",
        label: "accepted by owner",
        swatch: <span className="inline-block h-1.5 w-1.5 rounded-[1px] border border-slate-300" />,
        hint: "A hollow mark is a repository whose owner has accepted this gap. Counted beside the open repos, never subtracted, and never targeted by the issue draft.",
      }]
    : []),
  ...(decided
    ? [{
        id: "decided",
        label: "decided by the team",
        swatch: <span className="inline-block h-1.5 w-1.5 rounded-[1px] border border-dashed border-slate-300" />,
        hint: "A dashed mark is a repository whose team resolved this blocker (dismissed, accepted or snoozed). Counted beside the open repos, never targeted by the issue draft.",
      }]
    : []),
];

export function PassportBlockersV2({
  rows,
  scopeLabel,
  org,
  max = 8,
  decisions = {},
}: {
  rows: PassportRow[];
  scopeLabel: string;
  org: string;
  max?: number;
  decisions?: DecisionMap;
}) {
  const top = aggregateBlockers(rows, decisions).slice(0, max);
  const scope = scopeCounts(rows);
  const [draft, setDraft] = useState<IssueDraft | null>(null);
  const anyDeclined = top.some((a) => a.declinedRepos.length > 0);
  const anyDismissed = top.some((a) => a.dismissedRepos.length > 0);

  if (top.length === 0) {
    return <p className="type-body text-slate-300">No blockers on record for the repos in view.</p>;
  }

  return (
    <div>
      <Caption>
        Top blockers, {scopeLabel}. {scope.repos} repo{scope.repos === 1 ? "" : "s"}
        {scope.placeholderRepos > 0 && (
          <span title={PLACEHOLDER_TITLE}>
            , of which {scope.placeholderRepos} from {PLACEHOLDER_LABEL}s
          </span>
        )}
      </Caption>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Legend extra={legend(anyDeclined, anyDismissed)} />
        <WhyChip hint={RANK_HINT} label="how this docket is ranked" />
      </div>
      <HairlineList className="mt-3">
        {top.map((a) => (
          <li key={a.code}>
            <button
              type="button"
              onClick={() => setDraft(draftFor(a, org, scopeLabel, rows.length))}
              title="File this blocker as GitHub issues in the affected repos"
              className="focus-ring flex w-full items-baseline gap-3 py-3 text-left"
            >
              <span className="min-w-0 flex-1 text-[0.9375rem] leading-snug text-slate-200">{a.label}</span>
              <span className="shrink-0 type-caption text-slate-400">{a.axis === "automation" ? "Automation" : "Production"}</span>
              <span aria-hidden className="flex max-w-28 shrink-0 flex-wrap justify-end gap-0.5">
                {a.repos.slice(0, MAX_MARKS).map((r) => (
                  <span key={r.fullName} title={r.name} className="h-1.5 w-1.5 rounded-[1px] bg-slate-300" />
                ))}
                {a.declinedRepos.slice(0, MAX_SIDE).map((r) => (
                  <span key={`d:${r.fullName}`} title={`${r.name}: accepted by choice`} className="h-1.5 w-1.5 rounded-[1px] border border-slate-300" />
                ))}
                {a.dismissedRepos.slice(0, MAX_SIDE).map((r) => (
                  <span key={`x:${r.fullName}`} title={`${r.name}: decided by the team`} className="h-1.5 w-1.5 rounded-[1px] border border-dashed border-slate-300" />
                ))}
              </span>
              <span className="shrink-0 tabular-nums text-white">{a.repos.length}</span>
              {a.declinedRepos.length > 0 && (
                <span title={`${a.declinedRepos.length} repo(s) declined this gap by choice: counted, never subtracted`} className="type-caption tabular-nums text-slate-400">
                  +{a.declinedRepos.length} accepted
                </span>
              )}
              {a.dismissedRepos.length > 0 && (
                <span title={`${a.dismissedRepos.length} repo(s) decided by the team: counted, never targeted`} className="type-caption tabular-nums text-slate-400">
                  +{a.dismissedRepos.length} decided
                </span>
              )}
            </button>
          </li>
        ))}
      </HairlineList>
      <CreateIssueModal draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
