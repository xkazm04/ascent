// @vitest-environment jsdom
//
// The /org redesign's Contributors wave: this tab was 1473 characters of prose, five tables and zero
// SVG — a page about DISTRIBUTION rendered as sorted lists. These pin the graphics that replaced the
// sentences, and above all the two distinctions the prose could never enforce:
//   1. a contributor with nothing to take a share OF renders a VOID, not a 0% bar;
//   2. a withheld population renders a withholding, not "not enough data".

import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiBar } from "./AiBar";
import { ContributorsAdoptionStrip } from "./ContributorsAdoptionStrip";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { ChampionScatter } from "./ChampionScatter";
import type { ContributorInsights } from "@/lib/db";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

function contributor(login: string, commits: number, aiShare: number): ContributorInsights["contributors"][number] {
  return {
    login,
    name: null,
    commits,
    aiCommits: Math.round((commits * aiShare) / 100),
    aiShare,
    repos: 2,
    repoNames: ["acme/api", "acme/web"],
    lastActiveAt: "2026-09-01T00:00:00.000Z",
    championScore: aiShare,
  };
}

function insights(over: Partial<ContributorInsights> = {}): ContributorInsights {
  return {
    org: "acme",
    totalContributors: 4,
    aiActive: 3,
    aiActiveShare: 75,
    orgAiShare: 40,
    soloMaintainerCount: 0,
    staleRepos: 0,
    distribution: { high: 1, some: 2, none: 1 },
    namingAllowed: true,
    contributors: [contributor("ada", 90, 80), contributor("bob", 40, 20), contributor("cy", 10, 0), contributor("di", 60, 50)],
    champions: [],
    concentration: [],
    resilience: null,
    ...over,
  };
}

describe("AiBar speaks the state vocabulary", () => {
  it("renders a measured share as a meter carrying the value", () => {
    render(<AiBar pct={42} label="ada AI share" />);
    const bar = screen.getByRole("progressbar", { name: "ada AI share" });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("renders a NULL share as the missing void — never a 0% bar", () => {
    const { container } = render(<AiBar pct={null} label="cy AI share" />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    // The void swatch carries the caveat that used to be nowhere at all.
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/an absence, never a zero/i);
  });
});

describe("ContributorsAdoptionStrip is the tab's first sight", () => {
  it("plots the org's AI-share spread and marks the viewer's own position", () => {
    const { container } = render(<ContributorsAdoptionStrip insights={insights()} viewerLogin="ada" />);
    expect(container.querySelector("[data-box]")).toBeTruthy();
    expect(container.querySelector("[data-you]")).toBeTruthy();
  });

  it("plots no 'you' marker for a viewer who is not in the roster", () => {
    const { container } = render(<ContributorsAdoptionStrip insights={insights()} viewerLogin="nobody" />);
    expect(container.querySelector("[data-box]")).toBeTruthy();
    expect(container.querySelector("[data-you]")).toBeNull();
  });

  it("below the naming floor says the spread is WITHHELD, not that data is thin", () => {
    const { container } = render(
      <ContributorsAdoptionStrip insights={insights({ namingAllowed: false, contributors: [] })} viewerLogin="ada" />,
    );
    expect(container.querySelector("[data-box]")).toBeNull();
    expect(container.textContent ?? "").toMatch(/withheld below 3 contributors/i);
  });
});

describe("Concentration is a curve, with the table as evidence", () => {
  it("draws the Lorenz curve and marks the risk knee", () => {
    const { container } = render(
      <ContributorsConcentrationTable slug="acme" rows={[]} contributors={insights().contributors} namingAllowed decisions={{}} />,
    );
    expect(container.querySelector("[data-curve]")).toBeTruthy();
    expect(container.querySelector("[data-knee]")).toBeTruthy();
    expect(container.querySelector("[data-gini]")).toBeTruthy();
  });

  it("withholds the curve below the floor while keeping the per-repo findings", () => {
    const { container } = render(
      <ContributorsConcentrationTable slug="acme" rows={[]} contributors={[]} namingAllowed={false} decisions={{}} />,
    );
    expect(container.querySelector("[data-curve]")).toBeNull();
    expect(container.textContent ?? "").toMatch(/per-repo findings below are unaffected/i);
  });
});

describe("A champion is a position, not a rank", () => {
  it("plots each champion and shades the high-adoption band", () => {
    const { container } = render(
      <ChampionScatter
        points={[
          { login: "ada", aiShare: 80, commits: 90, repos: 4, isViewer: true },
          { login: "bob", aiShare: 20, commits: 40, repos: 1, isViewer: false },
        ]}
      />,
    );
    expect(container.querySelector('[data-point="ada"]')).toBeTruthy();
    expect(container.querySelector('[data-point="bob"]')).toBeTruthy();
    expect(container.querySelector("[data-band]")).toBeTruthy();
    expect(container.querySelector("[data-you]")).toBeTruthy();
    // Dense chart ⇒ an sr-only table built from the same numbers the geometry is.
    expect(container.querySelector("table.sr-only")).toBeTruthy();
  });

  it("degrades to a labelled placeholder rather than plotting NaN", () => {
    render(<ChampionScatter points={[{ login: "x", aiShare: Number.NaN, commits: Number.NaN, repos: 1, isViewer: false }]} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/no measured champions/i);
  });
});
