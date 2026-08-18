// @vitest-environment jsdom
//
// The coverage strip leads with ABSENCE (staleRepos), the one thing the browsable list below can never
// show on its own. Moved into library/memory/ with no test coverage; pins the honest-zero behavior for
// an org that tracks no repos, the "+N more" fallback past STALE_SHOWN, and that a never-covered repo
// reads "never" rather than a fabricated date.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryCoverageStrip } from "./MemoryCoverageStrip";
import type { MemoryCoverage } from "@/lib/memory/coverage";

function coverage(overrides: Partial<MemoryCoverage>): MemoryCoverage {
  return {
    reposWithFreshMemory: 0,
    totalTrackedRepos: 0,
    coveragePct: 0,
    staleRepos: [],
    windowDays: 30,
    ...overrides,
  };
}

describe("MemoryCoverageStrip", () => {
  it("renders an honest em-dash, not a vacuous 100%, when the org tracks no repos", () => {
    render(<MemoryCoverageStrip coverage={coverage({ totalTrackedRepos: 0, coveragePct: 0 })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no repos tracked yet")).toBeInTheDocument();
  });

  it("names a never-covered repo 'never', not a fabricated last-memory date", () => {
    render(
      <MemoryCoverageStrip
        coverage={coverage({
          totalTrackedRepos: 1,
          coveragePct: 0,
          staleRepos: [{ fullName: "acme/api", lastMemoryAt: null }],
        })}
      />,
    );
    expect(screen.getByText("never")).toBeInTheDocument();
  });

  it("caps the named stale repos and shows a '+N more' overflow", () => {
    const staleRepos = Array.from({ length: 7 }, (_, i) => ({
      fullName: `acme/repo-${i}`,
      lastMemoryAt: null,
    }));
    render(<MemoryCoverageStrip coverage={coverage({ totalTrackedRepos: 7, staleRepos })} />);
    expect(screen.getAllByText("never")).toHaveLength(5);
    expect(screen.getByText("+2 more")).toBeInTheDocument();
  });

  it("declares full coverage when nothing is stale", () => {
    render(
      <MemoryCoverageStrip
        coverage={coverage({ totalTrackedRepos: 3, reposWithFreshMemory: 3, coveragePct: 100, staleRepos: [] })}
      />,
    );
    expect(screen.getByText("every repo is covered")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });
});
