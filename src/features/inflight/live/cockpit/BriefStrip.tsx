"use client";

// WHAT THE ORGANIZATION'S OWN STANDARD ACTUALLY CONTAINS for the batch about to be dispatched.
//
// The value of this strip is mostly in what it says is MISSING. "2 playbooks · house pattern from 3
// practices · 4 memories · no skill · 8.1 KB" tells an operator, before they spend a session, that
// the agent is about to work D9 with nothing of theirs to follow — which is a reason to write the
// playbook first, and a fact nothing in the product surfaced before.
//
// …AND THAT LINE IS NOT A SENTENCE, SO IT NO LONGER RENDERS AS ONE. Middot-joined and wrapped into a
// grey paragraph beside the repo name, the one fact worth reading ("no skill") sat mid-line among six
// that were fine. It is a LIST of facts, so it renders as a list: one bullet per fact, one row each,
// under the project name — which is white, because the name is what an operator scans for when the
// strip covers several repositories. `briefSummaryParts` (lane-brief.ts) is the shared fold, so the
// lane log's single line and these rows can never phrase the same provenance two ways.
//
// Built from the SAME assembly the engine runs (the propose route calls `buildLaneBrief`), so the
// preview cannot promise a standard the lane then does not use.

import { InfoTip, Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { briefSummaryParts, type BriefSummaryPart } from "@/lib/org/lane-brief";
import type { LoopProposal } from "./loopTypes";

/** The inspector's nothing-selected state. Co-located here rather than inline in CockpitInspector,
 *  which is at the 200-LOC cap — the strip and the empty state are both "what the rail says before a
 *  run", so they sit together. */
export function InspectorEmpty() {
  return (
    <div>
      <Kicker tone="accent">Inspector</Kicker>
      <InlineEmpty>Lasso or click bodies to select the repos this run should work.</InlineEmpty>
    </div>
  );
}

/** Tone per fact. A MISSING section is the news, so it is the one that is not grey-on-grey; the byte
 *  figure is bookkeeping and recedes. */
const PART_TONE: Record<BriefSummaryPart["kind"], string> = {
  have: "text-slate-400",
  none: "text-warn/80",
  size: "text-slate-600",
};

const PART_GLYPH: Record<BriefSummaryPart["kind"], string> = { have: "•", none: "◦", size: "·" };

function BriefFacts({ parts }: { parts: BriefSummaryPart[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {parts.map((part) => (
        <li key={`${part.kind}:${part.text}`} className={`flex items-baseline gap-1.5 type-caption ${PART_TONE[part.kind]}`}>
          <span aria-hidden className="w-2 shrink-0 text-center text-slate-600">
            {PART_GLYPH[part.kind]}
          </span>
          <span className="min-w-0">{part.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function BriefStrip({ proposals }: { proposals: LoopProposal[] }) {
  const briefed = proposals.filter((p) => p.brief != null);
  if (briefed.length === 0) return null;
  return (
    <div className="mt-3">
      <span className="flex items-center gap-1.5">
        <Kicker tone="muted">Brief</Kicker>
        <InfoTip label="what the brief is assembled from">
          Assembled from this organization&rsquo;s active playbooks, the pattern mined from its own repositories, its
          procedural memory, its registry skills, and the last scan&rsquo;s evidence — filtered to this batch&rsquo;s
          dimensions. A section it has none of is stated in the brief in words.
        </InfoTip>
      </span>
      <ul className="mt-2 space-y-3">
        {briefed.map((p) => (
          <li key={p.repo}>
            <span className="type-body-sm block truncate font-medium text-white" title={p.repo}>
              {p.repo.split("/")[1] ?? p.repo}
            </span>
            <BriefFacts parts={briefSummaryParts(p.brief!.provenance)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
