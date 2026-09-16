/** @vitest-environment jsdom */

// MC-B43. The `hosted` not-ready state exists to tell a reader that a LOCAL lane needs a self-hosted
// Ascent — so the guide link is the one actionable thing on it. It was built on `sourceRepoHref`,
// which by deliberate design returns null when NEXT_PUBLIC_SOURCE_REPO_URL is unset (a licence link
// must not guess a repository), and the variable is inlined at BUILD time and set in no committed env
// file — so on every unconfigured deployment the panel printed a file path instead of a link, exactly
// the degradation MC-B22 fixed on the four marketing surfaces. `docHref` has the opposite rule: a doc
// link is a reading reference, upstream's copy is the second-best address, and no address is worst.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DOCS_ARE_UPSTREAM, SELF_HOST_GUIDE_PATH, selfHostGuideHref } from "@/lib/site";
import { CockpitSetup } from "./CockpitSetup";

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
