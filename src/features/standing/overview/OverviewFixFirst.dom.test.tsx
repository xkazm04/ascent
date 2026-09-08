// @vitest-environment jsdom
//
// The rendered guarantee behind the "Fix first" bars: a candidate with no scoring model draws NO
// bar and prints NO number.
//
// The pure model (fixFirstImpact.test.ts) pins the states; this pins that the drawing obeys them,
// because the failure mode is silent — a `<rect>` with width 0 and a "+0" beside it looks like a
// measured nothing, and the findings queue is the candidate it would mislabel.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { OverviewFixFirst } from "@/features/standing/overview/OverviewFixFirst";
import { deriveFixFirst, type FixFirstInputs } from "@/features/standing/overview/fixFirst";

const INPUTS: FixFirstInputs = {
  regressers: [{ name: "api", fullName: "acme/api", dOverall: -9 }],
  findings: [{ module: "security", repo: "acme/api", title: "Default branch is unprotected" }],
  goals: [{ label: "Reach L4", status: "active", pace: "behind", metricLabel: "Overall maturity", target: 70, current: 58 }],
  comparedRepos: 45,
};

const band = (inp: FixFirstInputs) => {
  const { container } = render(<OverviewFixFirst items={deriveFixFirst("acme", inp)} />);
  return container;
};

describe("OverviewFixFirst — the ranked impact band", () => {
  it("renders nothing at all when nothing is actionable", () => {
    const c = band({ regressers: [], findings: [], goals: [] });
    expect(c.firstChild).toBeNull();
  });

  it("opens on shapes: one track per candidate, drawn before any legend", () => {
    const c = band(INPUTS);
    expect(c.querySelectorAll("svg[role='img']").length).toBeGreaterThanOrEqual(3);
  });

  it("draws a bar only for the candidates whose gain was computable", () => {
    const c = band(INPUTS);
    // regression + goal are measured; the findings queue is not.
    expect(c.querySelectorAll("[data-bar]")).toHaveLength(2);
  });

  it("prints the gain for a measured candidate and NOTHING for the unmeasured one", () => {
    const c = band(INPUTS);
    expect(screen.getByText("+0.2")).toBeInTheDocument();
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(c.textContent).not.toMatch(/\+0(?![.\d])/);
  });

  it("scales the bars against each other, not each against itself", () => {
    const c = band(INPUTS);
    const widths = [...c.querySelectorAll("[data-bar]")].map((r) => Number(r.getAttribute("width")));
    // 0.2 of 12 is well under a fiftieth of the track; the two bars must not be the same length.
    expect(widths[0]).toBeLessThan(widths[1]!);
  });

  it("discloses the absence rather than leaving the empty track unexplained", () => {
    band(INPUTS);
    const voidMark = screen.getByLabelText(/Decide 1 security finding — No measurement/);
    expect(voidMark).toBeInTheDocument();
    expect(voidMark.getAttribute("aria-label")).toContain("no scoring model");
  });

  it("keeps every candidate a real link to its evidence", () => {
    band(INPUTS);
    expect(screen.getByRole("link", { name: /Triage api/ })).toHaveAttribute("href", "/report/acme/api");
    expect(screen.getByRole("link", { name: /security finding/ })).toHaveAttribute("href", "/org/acme?tab=security");
  });

  it("draws three voids, and no divide-by-zero, when nothing in the band is measurable", () => {
    const c = band({ ...INPUTS, comparedRepos: 0, goals: [{ label: "Reach L4", status: "active", pace: "behind" }] });
    expect(c.querySelectorAll("[data-bar]")).toHaveLength(0);
    expect([...c.querySelectorAll("rect")].every((r) => Number.isFinite(Number(r.getAttribute("width"))))).toBe(true);
  });
});
