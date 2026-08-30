// @vitest-environment jsdom
//
// The Register's one interaction: a column header is a real button carrying aria-expanded, the latest
// column opens expanded by default (full titles), an older one is compact (clipped titles with the
// full title in a tooltip), and toggling widens/narrows in place while also opening that run on the
// field. The empty state is designed, not blank.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix } from "./outcomeMatrix";
import { OutcomeRegister } from "./OutcomeRegister";
import { OutcomeSection } from "./OutcomeSection";

vi.mock("../cockpit/CockpitDrivePanel", () => ({ DriveVerdict: () => null }));

const LONG = "Add a coverage gate to the CI pipeline";

const lane = (o: Partial<LoopLaneRecord>): LoopLaneRecord => ({
  id: "l", runId: "r", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
  commits: 1, beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null, endedAt: null, ...o,
});

const outcome = (runId: string, title: string): LoopLaneOutcome => ({
  lane: lane({ id: `${runId}-l`, runId }),
  kind: "backlog",
  before: null,
  after: null,
  diff: fakeDiff(title),
  closedFollowUpIds: [],
  commits: 1,
});

function fakeDiff(title: string): LoopLaneOutcome["diff"] {
  return { recsMovedToDone: [{ id: "x", title, dimId: "D2", reconciliation: { state: "not-measured", dimId: "D2", before: null, after: null, delta: null, note: "" } }], dimensions: [], movements: [], closedGapCount: 1 } as unknown as LoopLaneOutcome["diff"];
}

const detail = (id: string, startedAt: string, title: string): LoopRunDetail => ({
  run: { id, orgId: "o", createdBy: null, phase: "done", repos: ["acme/one"], targets: [], concurrency: 1, maxCycles: 1, cycle: 1, curated: false, model: null, effort: null, startedAt, endedAt: null, error: null, createdAt: startedAt },
  lanes: [],
  outcomes: [outcome(id, title)],
});

const matrix = buildOutcomeMatrix([detail("old", "2026-08-20T10:00:00Z", LONG), detail("new", "2026-08-22T10:00:00Z", LONG)]);

describe("OutcomeRegister", () => {
  it("expands the latest column by default and clips the older one", () => {
    render(<OutcomeRegister matrix={matrix} selectedId={null} onOpen={vi.fn()} />);
    const heads = screen.getAllByRole("button", { expanded: true });
    expect(heads).toHaveLength(1);
    expect(screen.getByText(LONG)).toBeInTheDocument();
    expect(screen.getByTitle(LONG)).toHaveTextContent("Add a coverage gate to…");
  });

  it("toggles a column with a keyboard-operable button and opens that run", () => {
    const onOpen = vi.fn();
    render(<OutcomeRegister matrix={matrix} selectedId={null} onOpen={onOpen} />);
    const compact = screen.getByRole("button", { expanded: false });
    fireEvent.click(compact);
    expect(compact).toHaveAttribute("aria-expanded", "true");
    expect(onOpen).toHaveBeenCalledWith("old");
    expect(screen.getAllByText(LONG)).toHaveLength(2);
  });
});

describe("OutcomeSection", () => {
  it("designs the zero state and leads with the takeaway", () => {
    render(
      <OutcomeSection variant="register" runDetails={[]} liveDetail={null} openedDetail={null} selectedId={null} driveOutcome={null} onOpen={vi.fn()} onDismissDrive={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "No runs yet" })).toBeInTheDocument();
    expect(screen.getByText(/select repos in the sky and start a run/)).toBeInTheDocument();
  });
});
