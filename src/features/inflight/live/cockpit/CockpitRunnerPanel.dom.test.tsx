// @vitest-environment jsdom
//
// THE STANDING RUNNER IN THE RAIL (spark theater-upgrade, 2026-09-18). Rendered through
// `CockpitDrivePanel` — the component the rail actually mounts — because the claim is that a
// CONTINUOUS drive is read as a runner there: its three phases (running, paused on a breaker until a
// time, idle until the next repo wakes), each repo's state with a Resume for a paused one, and a Stop
// that says what it stops. And none of a bounded drive's words: no "run N/M", no debt.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CockpitDrivePanel } from "./CockpitDrivePanel";
import { STOPPING_RUNNER_LABEL } from "./CockpitRunnerPanel";
import type { LoopRunDetail } from "./loopTypes";
import { at, repoState, runnerDrive } from "./runner.fixture";

afterEach(cleanup);

const detail = (id: string, done: number, total: number): LoopRunDetail =>
  ({
    run: { id, phase: "running", cycle: 1, maxCycles: 3 },
    lanes: Array.from({ length: total }, (_, i) => ({ id: `lane-${i}`, phase: i < done ? "done" : "dispatching" })),
    outcomes: [],
  }) as unknown as LoopRunDetail;

const inFlight = { runId: "run-9", repos: ["acme/web"], debtBefore: 0, debtAfter: null, startedAt: at(12), endedAt: null };

describe("the runner's three phases", () => {
  it("running: the in-flight run's lanes, runs done with no cap, the ceiling", () => {
    const done = { runId: "run-8", repos: ["acme/web"], debtBefore: 0, debtAfter: 0, startedAt: at(11), endedAt: at(12), landed: 2, verifiedCloses: 1 };
    render(<CockpitDrivePanel drive={runnerDrive({ runs: [done, inFlight] })} runDetail={detail("run-9", 1, 2)} onStop={vi.fn()} />);
    expect(screen.getByText("Standing runner")).toBeInTheDocument();
    expect(screen.getByTestId("runner-phase")).toHaveTextContent("Running");
    expect(screen.getByText(/cycle 1\/3 · 1\/2 lanes done/)).toBeInTheDocument();
    expect(screen.getByText("1 run done")).toBeInTheDocument();
    expect(screen.getByText("2 landed")).toBeInTheDocument();
    expect(screen.getByText("ceiling $100.00 / day")).toBeInTheDocument();
    expect(screen.getByText("up 3 h 12 m")).toBeInTheDocument();
    // The bounded drive's vocabulary is absent — there is no cap and no debt target.
    expect(screen.queryByText(/run \d+\/\d+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/points of debt|green/)).not.toBeInTheDocument();
    // The recent-runs ledger measures a runner's run by what it delivered.
    expect(within(screen.getByTestId("runner-runs")).getByText("2 landed · 1 verified")).toBeInTheDocument();
  });

  it("paused: the breaker, until when, and the breaker's own sentence", () => {
    const drive = runnerDrive({
      phase: "paused",
      pausedReason: "spend-ceiling",
      pausedUntil: at(0, 0, 19),
      events: [{ event: "paused", at: at(12), repo: null, reason: "spend-ceiling", until: at(0, 0, 19), note: "Today's lane spend ($100.40) reached the runner's daily ceiling ($100.00) — pausing until midnight." }],
    });
    render(<CockpitDrivePanel drive={drive} runDetail={null} onStop={vi.fn()} />);
    expect(screen.getByTestId("runner-phase")).toHaveTextContent("Paused — spend ceiling until 00:00");
    expect(screen.getByText(/Today's lane spend \(\$100\.40\)/)).toBeInTheDocument();
    // A pause is a wait, not an end: Stop is still offered.
    expect(screen.getByRole("button", { name: "Stop runner" })).toBeInTheDocument();
  });

  it("paused on the session limit, and idle until the next repo wakes", () => {
    const { unmount } = render(
      <CockpitDrivePanel drive={runnerDrive({ phase: "paused", pausedReason: "session-limit", pausedUntil: at(15) })} runDetail={null} onStop={vi.fn()} />,
    );
    expect(screen.getByTestId("runner-phase")).toHaveTextContent("Paused — session limit until 15:00");
    unmount();
    const idle = runnerDrive({
      phase: "idle",
      repoState: [
        repoState({ repo: "acme/web", paused: "dry-backoff", pausedUntil: at(14, 20), dryStreak: 2 }),
        repoState({ repo: "acme/api", paused: "dry-backoff", pausedUntil: at(18), dryStreak: 1 }),
      ],
    });
    render(<CockpitDrivePanel drive={idle} runDetail={null} onStop={vi.fn()} />);
    expect(screen.getByTestId("runner-phase")).toHaveTextContent("Idle — next repo wakes 14:20");
    expect(screen.getByText("2 dry runs")).toBeInTheDocument();
  });
});

describe("per-repo state", () => {
  it("names each held repo's reason and note, and resumes it through the handler", () => {
    const onResumeRepo = vi.fn();
    const drive = runnerDrive({
      repoState: [
        repoState({ repo: "acme/web", paused: "branch-conflict", note: "Merging main in conflicted on src/app.ts.", aheadOfBase: 3 }),
        repoState({ repo: "acme/api", baseBranch: "develop", failureStreak: 2 }),
      ],
    });
    render(<CockpitDrivePanel drive={drive} runDetail={null} onStop={vi.fn()} onResumeRepo={onResumeRepo} />);
    const web = screen.getByTestId("runner-repos").querySelector('[data-repo="acme/web"]') as HTMLElement;
    expect(within(web).getByText(/paused · branch conflict/)).toBeInTheDocument();
    expect(within(web).getByText("Merging main in conflicted on src/app.ts.")).toBeInTheDocument();
    expect(within(web).getByText("3 ahead")).toBeInTheDocument();
    const api = screen.getByTestId("runner-repos").querySelector('[data-repo="acme/api"]') as HTMLElement;
    expect(within(api).getByText("working")).toBeInTheDocument();
    expect(within(api).getByText("→ develop")).toBeInTheDocument();
    expect(within(api).getByText("2 failed in a row")).toBeInTheDocument();
    expect(within(api).queryByRole("button", { name: /Resume/ })).not.toBeInTheDocument();

    fireEvent.click(within(web).getByRole("button", { name: "Resume acme/web" }));
    expect(onResumeRepo).toHaveBeenCalledWith("acme/web");
  });
});

describe("stopping", () => {
  it("says a stop is under way and what it keeps, and cannot be pressed twice", () => {
    render(<CockpitDrivePanel drive={runnerDrive({ phase: "idle", stopRequested: true })} runDetail={null} onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: STOPPING_RUNNER_LABEL })).toBeDisabled();
    expect(screen.getByText(/next beat, within a minute/)).toBeInTheDocument();
    expect(screen.getByText(/stays there until you merge it/)).toBeInTheDocument();
  });

  it("offers neither Stop nor Resume once the runner has ended", () => {
    const drive = runnerDrive({ phase: "stopped", endedAt: at(13), repoState: [repoState({ repo: "acme/web", paused: "repo-failures" })] });
    render(<CockpitDrivePanel drive={drive} runDetail={null} onStop={vi.fn()} onResumeRepo={vi.fn()} />);
    expect(screen.getByTestId("runner-phase")).toHaveTextContent("Stopped");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
