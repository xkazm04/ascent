"use client";

// WHAT THE ORGANIZATION'S OWN STANDARD ACTUALLY CONTAINS for the batch about to be dispatched.
//
// The value of this strip is mostly in what it says is MISSING. "2 playbooks · house pattern from 3
// practices · 4 memories · no skill · 8.1 KB" tells an operator, before they spend a session, that
// the agent is about to work D9 with nothing of theirs to follow — which is a reason to write the
// playbook first, and a fact nothing in the product surfaced before.
//
// Built from the SAME assembly the engine runs (the propose route calls `buildLaneBrief`), so the
// preview cannot promise a standard the lane then does not use.

import { Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { briefSummaryLine } from "@/lib/org/lane-brief";
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

export function BriefStrip({ proposals }: { proposals: LoopProposal[] }) {
  const briefed = proposals.filter((p) => p.brief != null);
  if (briefed.length === 0) return null;
  return (
    <div className="mt-3">
      <Kicker tone="muted">Brief</Kicker>
      <ul className="mt-1 space-y-1">
        {briefed.map((p) => (
          <li key={p.repo} className="font-mono text-xs leading-relaxed text-slate-500">
            <span className="text-slate-400">{p.repo.split("/")[1] ?? p.repo}</span>{" "}
            <span
              title="Assembled from this organization's active playbooks, the pattern mined from its own repositories, its procedural memory, its registry skills, and the last scan's evidence — filtered to this batch's dimensions. A section it has none of is stated in the brief in words."
            >
              {briefSummaryLine(p.brief!.provenance)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
