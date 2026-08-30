// @vitest-environment jsdom
//
// The two round-2 variants and the Step-0 cell rows, rendered over the shared fixture. Load-bearing:
// a refused cell prints its WORD and never its delta; a regression is a marked line; the live lane
// reads its stage; the empty state is a sentence; the fold hides the fifth row behind "+1 more".

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OutcomeEarned } from "./OutcomeEarned";
import { OutcomeReleaseNotes } from "./OutcomeReleaseNotes";
import { CellDeliverables } from "./OutcomeCellRows";
import { emptyFixture, fixture, liveFixture } from "./outcome.fixture";
import { runCells } from "./outcomeEntries";

describe("OutcomeReleaseNotes", () => {
  it("leads with the newest run, its lift sentence and one line per deliverable", () => {
    render(<OutcomeReleaseNotes matrix={fixture} selectedId={null} onOpen={() => {}} />);
    const heads = screen.getAllByRole("button", { name: /Run \d/ });
    expect(heads[0]!.textContent).toContain("Run 3");
    // the title is a claim naming the movers — never the net beside a per-repo delta it disagrees with
    expect(heads[0]!.textContent).toContain("payments-api climbed ▲+6, docs-site slipped ▼-3");
    expect(heads[0]!.textContent).not.toContain("+3");
    expect(screen.getByText("Hardened CI/CD security")).toBeTruthy();
    // a regression is the same line in the falling tone — the repo's own ▼-3 beside its name says the direction
    expect(screen.getByText("Regressed on documentation").className).toContain("text-warn");
    // the refused cell is a word — its +5 never appears
    expect(screen.getByText("uncommitted")).toBeTruthy();
    expect(screen.queryByText(/\+5/)).toBeNull();
    // the live lane reads its stage word — not the operator's sub-stage
    expect(screen.getByText("rescanning")).toBeTruthy();
  });

  it("opens an older run on click and replays it on the field", () => {
    const onOpen = vi.fn();
    render(<OutcomeReleaseNotes matrix={fixture} selectedId={null} onOpen={onOpen} />);
    expect(screen.queryByText("Strengthened automated testing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Run 2/ }));
    expect(onOpen).toHaveBeenCalledWith("run-2");
    expect(screen.getByText("Strengthened automated testing")).toBeTruthy();
  });

  it("says what to do at zero runs", () => {
    render(<OutcomeReleaseNotes matrix={emptyFixture} selectedId={null} onOpen={() => {}} />);
    expect(screen.getByText(/No runs yet/).textContent).toContain("start one");
  });
});

describe("OutcomeEarned", () => {
  it("leads with the verdict and justifies it row by row", () => {
    render(<OutcomeEarned matrix={fixture} selectedId={null} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("Earned another run, with a regression");
    expect(screen.getByText("payments-api")).toBeTruthy();
    expect(screen.getByText("uncommitted")).toBeTruthy();
    expect(screen.getByText("Added a coverage gate to CI").getAttribute("title")).toContain("Hardened CI/CD security");
    expect(screen.getByText(/rescanning/)).toBeTruthy();
  });

  it("judges the selected run and lists the others as rows", () => {
    const onOpen = vi.fn();
    render(<OutcomeEarned matrix={fixture} selectedId="run-2" onOpen={onOpen} />);
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("Earned another run");
    fireEvent.click(screen.getByRole("button", { name: /Run 3/ }));
    expect(onOpen).toHaveBeenCalledWith("run-3");
  });

  it("is still running on a live run, and empty-honest at zero", () => {
    const { unmount } = render(<OutcomeEarned matrix={liveFixture} selectedId={null} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("Still running");
    unmount();
    render(<OutcomeEarned matrix={emptyFixture} selectedId={null} onOpen={() => {}} />);
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("No run to judge yet");
  });
});

describe("CellDeliverables (Step 0)", () => {
  it("groups by kind, folds at four rows, and keeps movements for the widened state", () => {
    const cell = runCells(fixture, "run-3")[0]!;
    render(<CellDeliverables cell={cell} />);
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("Hardened")).toBeTruthy();
    expect(screen.queryByText("Added agent-readable docs")).toBeNull();
    expect(screen.queryByText(/gained token permissions/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(screen.getByText("Added agent-readable docs")).toBeTruthy();
    expect(screen.getByText(/gained token permissions/)).toBeTruthy();
    expect(screen.getByText("Token permissions [posture/high]: 0/10 → 8/10")).toBeTruthy();
  });
});
