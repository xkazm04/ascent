// @vitest-environment jsdom
//
// ONE TAG PER LANE, in the curation panel before the run. A foundation/practice lane spends no agent
// session and closes no rows on its own, so without the tag its row reads exactly like an agent lane
// that failed to do anything — which is the opposite of what happened.
//
// The outcome-ledger half of this file went with the ledger itself (wave-2: the rail has no outcome
// panel, the sheet under the grid is the outcome surface and it prints deliverables, not lane rows).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProposalList } from "./CockpitBatch";
import type { FollowUpItem, LoopProposal } from "./loopTypes";

const item = (id: string): FollowUpItem => ({
  id,
  repo: "acme/one",
  title: `gap ${id}`,
  dimId: "D1",
  dimLabel: "Agent guidance",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 4,
});

const proposal = (o: Partial<LoopProposal> = {}): LoopProposal => ({
  repo: "acme/one",
  items: [],
  projectedPoints: 0,
  kind: "backlog",
  practiceId: null,
  reason: "Works this repo's open follow-ups with a local agent.",
  ...o,
});

const list = (proposals: LoopProposal[]) =>
  render(
    <ProposalList proposals={proposals} pruned={new Set()} onTogglePrune={vi.fn()} dimFocus={null} unpaired={new Set()} />,
  );

describe("the curation panel leads with the foundation", () => {
  it("shows the tag and the reason, and says there is nothing to curate", () => {
    list([
      proposal({
        kind: "foundation",
        reason: "No .ai/ foundation in this repo — this lane installs the generated standard, then rescans.",
      }),
    ]);
    expect(screen.getByText(".ai/ foundation")).toBeTruthy();
    expect(screen.getByText(/installs the generated standard/)).toBeTruthy();
    expect(screen.getByText(/no rows to curate/)).toBeTruthy();
  });

  it("tags a practice lane while still letting the operator prune its row", () => {
    list([proposal({ kind: "practice", practiceId: "agent-guidance", items: [item("rec-1")], projectedPoints: 4, reason: "Agent guidance — installs AGENTS.md." })]);
    expect(screen.getByText("practice starter")).toBeTruthy();
    expect(screen.getByLabelText(/gap rec-1/)).toBeTruthy();
  });

  it("says the usual thing for an agent lane with an empty backlog", () => {
    list([proposal()]);
    expect(screen.getByText("nothing open here")).toBeTruthy();
  });
});
