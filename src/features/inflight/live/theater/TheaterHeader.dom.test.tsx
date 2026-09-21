// @vitest-environment jsdom
//
// The awareness header as RENDERED, per state: each of the four answers for running / paused (spend) /
// paused (session) / idle / no runner / stale, the live-dot only on a genuinely running fresh pulse,
// and the NEEDS YOU amber state with its ledger link.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TheaterHeader } from "./TheaterHeader";
import { DEMO_EPOCH, fixturePulse, fixturePulseAt, type DemoScenario } from "./theaterFixture";
import { headerModel, type HeaderInput } from "./theaterHeaderModel";

const LEDGER = "/org/acme?tab=live&view=ledger";

function renderState(o: Partial<HeaderInput> & { scenario?: DemoScenario } = {}) {
  const { scenario, ...rest } = o;
  const model = headerModel({
    pulse: scenario ? fixturePulseAt(DEMO_EPOCH, scenario) : fixturePulse(),
    loaded: true,
    stale: false,
    clock: DEMO_EPOCH,
    heardAgoMs: 1_000,
    error: null,
    ledgerHref: LEDGER,
    ...rest,
  });
  render(<TheaterHeader model={model} />);
  return {
    running: screen.getByRole("region", { name: "Running?" }),
    now: screen.getByRole("region", { name: "Now" }),
    today: screen.getByRole("region", { name: "Today" }),
    needs: screen.getByRole("region", { name: "Needs you" }),
  };
}

describe("TheaterHeader", () => {
  it("running: the four answers, the live-dot, the file being touched", () => {
    const b = renderState();
    expect(within(b.running).getByText("Running")).toBeInTheDocument();
    expect(within(b.running).getByTestId("theater-live-dot")).toBeInTheDocument();
    expect(b.running).toHaveTextContent(/run #14 · cycle 2\/3/);
    expect(b.now).toHaveTextContent(/kp · /);
    expect(b.now).toHaveTextContent("src/scoring/claims.ts");
    expect(b.today).toHaveTextContent(/verified/);
    expect(b.today).toHaveTextContent(/of \$100\.00/);
    expect(within(b.today).getByRole("meter", { name: "Spend of the daily ceiling" })).toBeInTheDocument();
    expect(b.needs).toHaveTextContent("Nothing waiting");
    expect(b.needs).not.toHaveAttribute("data-amber");
  });

  it("paused on spend: the breaker in words, no dot, and NEEDS YOU turns amber", () => {
    const b = renderState({ scenario: "paused-spend" });
    expect(b.running).toHaveTextContent("Paused — spend ceiling until 00:00");
    expect(screen.queryByTestId("theater-live-dot")).toBeNull();
    expect(b.now).toHaveTextContent("Holding");
    expect(b.needs).toHaveAttribute("data-amber", "true");
    expect(within(b.needs).getByRole("link", { name: /Open the ledger/ })).toHaveAttribute("href", LEDGER);
  });

  it("paused on the session limit", () => {
    const b = renderState({ scenario: "paused-session" });
    expect(b.running).toHaveTextContent(/Paused — session limit until \d\d:\d\d/);
    expect(screen.queryByTestId("theater-live-dot")).toBeNull();
  });

  it("idle: when the next repo wakes, and 'Resting' now", () => {
    const b = renderState({ scenario: "idle" });
    expect(b.running).toHaveTextContent(/Idle — next repo wakes at \d\d:\d\d/);
    expect(b.now).toHaveTextContent("Resting");
    expect(screen.queryByTestId("theater-live-dot")).toBeNull();
  });

  it("no runner", () => {
    const b = renderState({ pulse: null });
    expect(b.running).toHaveTextContent("No runner");
    expect(b.now).toHaveTextContent("Nothing running");
    expect(b.needs).toHaveTextContent("Nothing waiting");
  });

  it("stale: every liveness label switches to the truth and the dot goes out", () => {
    const b = renderState({ stale: true, heardAgoMs: 42_000 });
    expect(b.running).toHaveTextContent("Reconnecting…");
    expect(b.running).toHaveTextContent("Last heard 42 s ago");
    expect(within(b.running).queryByText("Running")).toBeNull();
    expect(b.now).toHaveTextContent("Last heard 42 s ago");
    expect(b.now).not.toHaveTextContent("src/scoring/claims.ts");
    expect(b.today).toHaveTextContent("as of 42 s ago");
    expect(screen.queryByTestId("theater-live-dot")).toBeNull();
  });

  it("needs-you amber with plans and paused repos, the count first", () => {
    const b = renderState({ pulse: fixturePulse({ needsYou: { plans: 2, pausedRepos: 1, runnerPaused: false } }) });
    expect(b.needs).toHaveAttribute("data-amber", "true");
    expect(b.needs).toHaveTextContent("32 plans wait · 1 repo paused");
  });

  it("the kiosk (no ledger link) shows the amber state without a link it cannot follow", () => {
    const b = renderState({ scenario: "paused-spend", ledgerHref: null });
    expect(b.needs).toHaveAttribute("data-amber", "true");
    expect(within(b.needs).queryByRole("link")).toBeNull();
  });

  it("each TODAY figure carries its predicate", () => {
    const b = renderState();
    expect(within(b.today).getByTitle(/Findings closed AND confirmed gone by a rescan, since local midnight/)).toBeInTheDocument();
    expect(within(b.today).getByTitle(/landed on the runner branch, since local midnight/)).toBeInTheDocument();
    expect(within(b.today).getByTitle(/Agent spend since local midnight/)).toBeInTheDocument();
  });
});
