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
