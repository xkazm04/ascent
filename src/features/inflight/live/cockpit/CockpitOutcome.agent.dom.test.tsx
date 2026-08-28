// @vitest-environment jsdom
//
// WHAT THE LIFT WAS PRODUCED UNDER. The outcome ledger compares lifts across runs, and until the run
// carried its agent configuration it printed those numbers with no way to tell a sonnet run at the
// deployment's default effort from an opus run at high effort — two different setups reported as one
// series. Split from CockpitOutcome.dom.test.tsx for the 200-LOC cap under src/features/**; the
// fixtures here are deliberately minimal, because none of these cases is about the diff.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CockpitOutcome } from "./CockpitOutcome";
import type { LoopRunDetail } from "./loopTypes";

/** A finished run with no lanes — enough to render the header, which is what these cases read. */
const detail = (run: Partial<LoopRunDetail["run"]> = {}): LoopRunDetail => ({
  run: {
    id: "run-1",
    orgId: "org-1",
    createdBy: "kaz",
    phase: "done",
    repos: ["acme/one"],
    concurrency: 2,
    maxCycles: 3,
    cycle: 1,
    curated: true,
    model: null,
    effort: null,
    startedAt: "2026-08-28T10:00:00Z",
    endedAt: "2026-08-28T10:30:00Z",
    error: null,
    createdAt: "2026-08-28T10:00:00Z",
    ...run,
  },
  lanes: [],
  outcomes: [],
});

const show = (run: Partial<LoopRunDetail["run"]> = {}) =>
  render(<CockpitOutcome detail={detail(run)} onReplay={vi.fn()} onBack={vi.fn()} canReplay={false} />);

describe("the agent configuration a lift was produced under", () => {
  it("names the model and the effort the run was armed with", () => {
    show({ model: "opus", effort: "high" });
    expect(screen.getByText("opus · high effort")).toBeInTheDocument();
  });

  it("names the model alone when no effort level was chosen — the flag was never passed", () => {
    // `null` effort is not a level. `--effort` is simply absent from the argv, so there is nothing
    // about it to report, and printing "default effort" would invent one.
    show({ model: "sonnet", effort: null });
    expect(screen.getByText("sonnet")).toBeInTheDocument();
  });

  it("renders NOTHING for a run recorded before the configuration was", () => {
    // The honesty case: "default" would be a claim about a run nobody can check. Unknown is not a
    // finding — the same rule engineDegraded and the platform fold record already follow.
    const { container } = show();
    expect(container.textContent).not.toContain("default");
    expect(screen.queryByText("sonnet")).not.toBeInTheDocument();
    expect(screen.queryByText(/effort/)).not.toBeInTheDocument();
  });
});
