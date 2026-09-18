/** @vitest-environment jsdom */

// THE MASTHEAD'S VIEW SWITCH AND THE RUNNER'S STOP (spark theater-upgrade, 2026-09-18).
//
//   - the shared `LiveViewSwitch` is mounted in the cockpit's masthead with Cockpit current, the
//     ledger link carries the href it was given, the theater opens its own page — and the wall link
//     is still there beside it;
//   - while a standing runner is on, Stop is "Stop runner" and its wind-down caption is the runner's
//     (a waiting runner stops at its next beat), not the run's "in-flight lanes finish their session".

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CockpitHeader } from "./CockpitHeader";

afterEach(cleanup);

const base = {
  slug: "acme",
  fleetCount: 4,
  active: null,
  laneCount: 0,
  live: false,
  wallHref: "?tab=live&view=wall",
  ledgerHref: "?tab=live&stack=web&view=ledger",
  cockpitHref: "?tab=live&stack=web&view=cockpit",
};

describe("CockpitHeader — the Live view switch", () => {
  it("mounts the switch with Cockpit current, beside the wall link", () => {
    render(<CockpitHeader {...base} />);
    const nav = screen.getByRole("navigation", { name: "Live views" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cockpit" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Ledger" })).toHaveAttribute("href", "?tab=live&stack=web&view=ledger");
    expect(screen.getByRole("link", { name: "Ledger" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Theater/ })).toHaveAttribute("href", "/theater/acme");
    expect(screen.getByRole("link", { name: "Wall" })).toHaveAttribute("href", "?tab=live&view=wall");
  });
});

describe("CockpitHeader — stopping a standing runner", () => {
  const hint = "Stops the runner at its next beat, within a minute — nothing is running while it waits.";

  it("labels Stop for what it stops", () => {
    render(<CockpitHeader {...base} live driveCaption="runner · idle" onStop={() => {}} stopLabel="Stop runner" stopCaption={hint} />);
    expect(screen.getByRole("button", { name: "Stop runner" })).toHaveAttribute("title", hint);
    expect(screen.getByText("runner · idle")).toBeInTheDocument();
  });

  it("narrates the runner's wind-down, not the run's", () => {
    render(<CockpitHeader {...base} live onStop={() => {}} stopLabel="Stop runner" stopCaption={hint} stopRequested stopHorizonMs={1_200_000} />);
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.queryByText(/finish their current session/)).toBeNull();
  });
});
