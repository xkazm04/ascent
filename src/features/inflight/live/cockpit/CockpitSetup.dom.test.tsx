/** @vitest-environment jsdom */

// MC-B43. The `hosted` not-ready state exists to tell a reader that a LOCAL lane needs a self-hosted
// Ascent — so the guide link is the one actionable thing on it. It was built on `sourceRepoHref`,
// which by deliberate design returns null when NEXT_PUBLIC_SOURCE_REPO_URL is unset (a licence link
// must not guess a repository), and the variable is inlined at BUILD time and set in no committed env
// file — so on every unconfigured deployment the panel printed a file path instead of a link, exactly
// the degradation MC-B22 fixed on the four marketing surfaces. `docHref` has the opposite rule: a doc
// link is a reading reference, upstream's copy is the second-best address, and no address is worst.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DOCS_ARE_UPSTREAM, SELF_HOST_GUIDE_PATH, selfHostGuideHref } from "@/lib/site";
import { CockpitSetup } from "./CockpitSetup";
import type { RemoteArm } from "./CockpitRemoteArm";

describe("CockpitSetup — the self-hosting guide is always a link", () => {
  it("renders an anchor, never a printed file path, whatever the source-repo env is", () => {
    render(<CockpitSetup state="hosted" slug="acme" />);
    const link = screen.getByRole("link", { name: /Self-hosting guide/i });
    expect(link).toHaveAttribute("href", selfHostGuideHref());
    expect(link.getAttribute("href")).toMatch(/^https?:\/\//);
    // The old degraded branch: "See docs/SETUP.md in the source repository."
    expect(screen.queryByText(/in the source repository/i)).toBeNull();
  });

  it("points at the guide the label promises, not at the preconditions page", () => {
    render(<CockpitSetup state="hosted" slug="acme" />);
    const href = screen.getByRole("link", { name: /Self-hosting guide/i }).getAttribute("href")!;
    expect(href).toContain(SELF_HOST_GUIDE_PATH);
    expect(href).not.toContain("docs/SETUP.md");
  });

  it("says the guide is upstream's when this deployment has not named its own repository", () => {
    render(<CockpitSetup state="hosted" slug="acme" />);
    const name = screen.getByRole("link", { name: /Self-hosting guide/i }).textContent ?? "";
    // Same disclosure the four MC-B22 surfaces carry — borrowed copy is labelled borrowed.
    expect(/\(upstream\)/.test(name)).toBe(DOCS_ARE_UPSTREAM);
  });

  it("leaves the other not-ready states alone — only `hosted` carries the guide", () => {
    render(<CockpitSetup state="autopilot-off" slug="acme" />);
    expect(screen.queryByRole("link", { name: /Self-hosting guide/i })).toBeNull();
  });
});

// ADR-0001. The SECOND cloud card. `hosted` says "this deployment has no loop for you"; this one says
// "this deployment does, and your organization may not use it yet" — a different sentence with a
// different next action, which is why it is a different state rather than different copy on one.
describe("CockpitSetup — `hosted-not-enabled`", () => {
  // THE SERVER'S SENTENCE, VERBATIM. Plan, credit headroom and per-repo admission are three walls
  // with three different fixes, and only the server knows which one refused — a card that re-derived
  // it in the browser would name the wrong action two times in three.
  it("renders the server's own reason rather than a guess", () => {
    render(<CockpitSetup state="hosted-not-enabled" slug="acme" message="This organization has no credit headroom, and a hosted run spends credits." />);
    expect(screen.getByText(/no credit headroom/i)).toBeInTheDocument();
  });

  it("still says something actionable when the server sent no reason", () => {
    render(<CockpitSetup state="hosted-not-enabled" slug="acme" />);
    expect(screen.getByText(/not enabled for this organization/i)).toBeInTheDocument();
  });

  // It must NOT be the self-hosting card. Telling a cloud owner on a deployment that does operate a
  // worker to go and self-host is the exact misdirection ADR-0001 set out to retire.
  it("does not send a cloud owner off to self-host", () => {
    render(<CockpitSetup state="hosted-not-enabled" slug="acme" />);
    expect(screen.queryByRole("link", { name: /Self-hosting guide/i })).toBeNull();
  });

  // Every link on a card whose job is to name a next action has to be a real destination. The
  // fabricated `?tab=billing` this card first shipped with is pinned out by name.
  it("links only to destinations that exist", () => {
    render(<CockpitSetup state="hosted-not-enabled" slug="acme" />);
    expect(screen.getByRole("link", { name: /Plans & pricing/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /Repository admission/i })).toHaveAttribute("href", "/org/acme?tab=governance");
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toContain("tab=billing");
  });

  // The degraded door stays open and stays named: a run the customer's OWN agent claims needs none
  // of the three gates above, and it is what this org can do today.
  it("keeps the remote-agent fallback visible", () => {
    render(<CockpitSetup state="hosted-not-enabled" slug="acme" />);
    expect(screen.getByText(/Remote-agent runs still work here/i)).toBeInTheDocument();
  });
});

// ROW 29 (backlog develop-2026-09-17). Both cloud cards used to DESCRIBE the remote-agent run ("arm one
// through the API") that the deployment's own POST route accepts, and offer no way to start it. The
// arm now sits on the card itself, for an owner with repos (the caller's `canArmRemote`), and nowhere
// else: the local lane and the drive are still self-hosted only.
describe("CockpitSetup — the remote-agent arm on the cloud cards", () => {
  const arm = (over: Partial<RemoteArm> = {}): RemoteArm => ({ repos: 2, onArm: vi.fn(), busy: false, error: null, ...over });

  it.each(["hosted", "hosted-not-enabled"] as const)("offers an owner a remote run on the `%s` card", (state) => {
    const remote = arm();
    render(<CockpitSetup state={state} slug="acme" remote={remote} />);
    fireEvent.click(screen.getByRole("button", { name: "Arm remote run (2 repos)" }));
    expect(remote.onArm).toHaveBeenCalledTimes(1);
    // Honest about who works it: nothing spawns here, the lanes wait for the org's own agent.
    expect(screen.getByText(/wait for an agent you run to claim them/i)).toBeInTheDocument();
  });

  it("disables the arm and says why when nothing is selected", () => {
    render(<CockpitSetup state="hosted" slug="acme" remote={arm({ repos: 0 })} />);
    expect(screen.getByRole("button", { name: /Select repos on the chart/i })).toBeDisabled();
  });

  it("renders a refused arm's own error on the card", () => {
    render(<CockpitSetup state="hosted" slug="acme" remote={arm({ error: "A loop run is already active for acme." })} />);
    expect(screen.getByText("A loop run is already active for acme.")).toBeInTheDocument();
  });

  it("guard: with no arm (a member, or no repos) the card only describes the API door", () => {
    render(<CockpitSetup state="hosted" slug="acme" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Remote-agent runs do work here/i)).toBeInTheDocument();
  });

  it("guard: a local not-ready card never grows a remote arm", () => {
    render(<CockpitSetup state="autopilot-off" slug="acme" remote={arm()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
