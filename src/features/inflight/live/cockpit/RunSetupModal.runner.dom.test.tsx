// @vitest-environment jsdom
//
// THE SETUP DIALOG IN STANDING-RUNNER MODE (spark theater-upgrade, 2026-09-18). Pinned:
//
//   - the MODE choice offers Run · Drive to green · Standing runner and reports the pick;
//   - the runner's two FORCED settings (delivery, the guard) are DISPLAYED — with their reasons — and
//     are not editable: no radio, no input, nothing focusable in them; the check budget stays a dial;
//   - the fixed summary of what the runner does is on the page before Start;
//   - the ceiling defaults to the contract's $100, and an empty one disables Start with its reason;
//   - the mode-specific dials follow the mode (the rope only for a drive, rescan cadence not for a run).

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunSetupModal, type RunnerSetup } from "./RunSetupModal";
import { INITIAL_DIALS, type RunDials } from "./useRunDials";

afterEach(cleanup);

const runnerSetup = (over: Partial<RunnerSetup> = {}): RunnerSetup => ({
  repos: ["acme/web", "acme/api"],
  selection: [],
  onStart: vi.fn(),
  busy: false,
  error: null,
  blocked: null,
  ...over,
});

const open = (over: Partial<RunDials> = {}, runner: RunnerSetup | undefined = runnerSetup()) => {
  const onChange = vi.fn();
  render(<RunSetupModal open onClose={vi.fn()} dials={{ ...INITIAL_DIALS, ...over }} onChange={onChange} dims={[]} runner={runner} />);
  return { onChange };
};

describe("the mode choice", () => {
  it("offers the three starts and reports the pick", () => {
    const { onChange } = open();
    const modes = within(screen.getByTestId("setup-mode")).getAllByRole("radio");
    expect(modes.map((m) => m.textContent)).toEqual(["Run", "Drive to green", "Standing runner"]);
    fireEvent.click(modes[2]!);
    expect(onChange).toHaveBeenCalledWith("mode", "runner");
  });

  it("shows the rope only for a drive, and rescan cadence only where it is sent", () => {
    open({ mode: "run" });
    expect(screen.queryByTestId("setup-max-runs")).toBeNull();
    expect(screen.queryByTestId("setup-rescan")).toBeNull();
    cleanup();
    open({ mode: "drive" });
    expect(screen.getByTestId("setup-max-runs")).toBeTruthy();
    expect(screen.getByTestId("setup-rescan")).toBeTruthy();
    cleanup();
    open({ mode: "runner" });
    expect(screen.queryByTestId("setup-max-runs")).toBeNull();
    expect(screen.getByTestId("setup-rescan")).toBeTruthy();
  });
});

describe("standing-runner mode", () => {
  it("displays the forced settings, with reasons, and makes neither editable", () => {
    open({ mode: "runner", delivery: "land", verifyMode: "off" });
    // The pickers are gone…
    expect(screen.queryByTestId("setup-delivery")).toBeNull();
    expect(screen.queryByTestId("setup-verify-mode")).toBeNull();
    // …and the forced values stand in their place, whatever the run's dials said.
    const delivery = screen.getByTestId("setup-forced-delivery");
    const verify = screen.getByTestId("setup-forced-verify");
    expect(delivery).toHaveTextContent("Land on the runner branch");
    expect(delivery).toHaveTextContent("forced");
    expect(verify).toHaveTextContent("Verify each lane");
    for (const el of [delivery, verify]) expect(el.querySelector("button, input, select, [role=radio]")).toBeNull();
    expect(screen.getByText(/runner delivers nowhere else/)).toBeInTheDocument();
    expect(screen.getByText(/guard cannot be switched off/)).toBeInTheDocument();
    // The budget of the check is still the operator's.
    expect((screen.getByTestId("setup-verify-minutes") as HTMLSelectElement).disabled).toBe(false);
  });

  it("states what the runner does before it can be started", () => {
    open({ mode: "runner" });
    const does = screen.getByTestId("runner-does");
    expect(does).toHaveTextContent("Lands verified work on each repo's ascent/runner branch — your working branch is never touched");
    expect(does).toHaveTextContent("Plans every lane first; only architecture moves wait for you");
    expect(does).toHaveTextContent("Pauses on: spend ceiling, session limit, 3 failed lanes on a repo, a branch conflict");
  });

  it("shows the default scope, and offers the selection only when there is one", () => {
    open({ mode: "runner" });
    expect(within(screen.getByTestId("runner-scope-repos")).getByText("web")).toBeInTheDocument();
    const scope = within(screen.getByTestId("setup-runner-scope")).getAllByRole("radio") as HTMLButtonElement[];
    expect(scope[1]!.disabled).toBe(true);
  });

  it("defaults the ceiling to $100, says the session-limit breaker is always on, and starts", () => {
    const runner = runnerSetup();
    open({ mode: "runner" }, runner);
    expect((screen.getByTestId("setup-spend-ceiling") as HTMLInputElement).value).toBe("100");
    expect(screen.getByText(/0 means no ceiling\. The session-limit breaker is always on/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("setup-start-runner"));
    expect(runner.onStart).toHaveBeenCalledOnce();
  });

  it("refuses an empty ceiling with its reason rather than reading it as none", () => {
    open({ mode: "runner", spendCeiling: "" });
    expect(screen.getByText(/Enter a daily ceiling in US dollars/)).toBeInTheDocument();
    expect(screen.getByTestId("setup-start-runner")).toBeDisabled();
  });

  it("says why it cannot start while a drive or runner is already on, and shows the route's refusal", () => {
    open({ mode: "runner" }, runnerSetup({ blocked: "A drive or a standing runner is already on.", error: "spendCeilingUsd is too large." }));
    expect(screen.getByTestId("setup-start-runner")).toBeDisabled();
    expect(screen.getByText("A drive or a standing runner is already on.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("spendCeilingUsd is too large.");
  });

  it("prints the runner's configuration in the footer", () => {
    open({ mode: "runner", spendCeiling: "0" });
    expect(screen.getByTestId("setup-summary")).toHaveTextContent("standing runner · every watched, paired repo · no spend ceiling");
  });
});
