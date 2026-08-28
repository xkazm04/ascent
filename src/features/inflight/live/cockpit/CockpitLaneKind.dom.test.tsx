// @vitest-environment jsdom
//
// ONE TAG PER LANE, in both places a lane is shown: the curation panel before the run and the outcome
// ledger after it. A foundation/practice lane spends no agent session and closes no rows on its own,
// so without the tag its ledger row reads exactly like an agent lane that failed to do anything —
// which is the opposite of what happened.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutcomeRow } from "./CockpitOutcomeLedger";
import { ProposalList } from "./CockpitBatch";
import type { FollowUpItem, LoopLaneKind, LoopLaneOutcome, LoopLaneRecord, LoopProposal } from "./loopTypes";

const lane = (o: Partial<LoopLaneRecord> = {}): LoopLaneRecord => ({
  id: "lane-1",
  runId: "run-1",
  repoFullName: "acme/one",
  cycle: 1,
  phase: "done",
  branch: "ascent/loop-1",
  batchIds: [],
  closedIds: [],
  commits: 1,
  beforeScanId: null,
  afterScanId: null,
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
  ...o,
});

const outcome = (kind: LoopLaneKind): LoopLaneOutcome => ({
  lane: lane(),
  kind,
  before: null,
  after: null,
  diff: null,
  closedFollowUpIds: [],
  commits: 1,
});

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

describe("the outcome ledger prints what a lane DID", () => {
  it("tags a foundation lane", () => {
    render(<ul>{<OutcomeRow outcome={outcome("foundation")} />}</ul>);
    expect(screen.getByText(".ai/ foundation")).toBeTruthy();
  });

  it("tags a practice lane", () => {
    render(<ul>{<OutcomeRow outcome={outcome("practice")} />}</ul>);
    expect(screen.getByText("practice starter")).toBeTruthy();
  });

  it("leaves the ordinary agent lane untagged — a badge on every row would say nothing", () => {
    render(<ul>{<OutcomeRow outcome={outcome("backlog")} />}</ul>);
    expect(screen.queryByText(".ai/ foundation")).toBeNull();
    expect(screen.queryByText("practice starter")).toBeNull();
    expect(screen.getByText("acme/one")).toBeTruthy();
  });
});

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
