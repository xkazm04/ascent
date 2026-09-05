/** @vitest-environment jsdom */

// The per-repo spend panel. The column that matters is the new one: a repository nothing could price
// must read as an em dash with the reason on hover, NEVER as $0.00 — the rule the showback matrix's
// cells already hold, applied to the panel that until now counted scans and tokens and no money.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RepoUsage } from "@/lib/db/usage";
import { TopReposPanel } from "./usageRepoPanel";

const repo = (o: Partial<RepoUsage> & { fullName: string | null }): RepoUsage => ({
  label: o.fullName ?? "Org-wide (no repo)",
  scans: 3,
  tokens: 1200,
  calls: 3,
  estimatedCostUsd: 4.5,
  unpricedCalls: 0,
  ...o,
});

const draw = (rows: RepoUsage[]) => render(<TopReposPanel byRepo={rows} periodDays={30} />);

describe("the top-repositories panel", () => {
  it("prints each repository's cost beside its metered volume", () => {
    draw([repo({ fullName: "acme/api" })]);
    expect(screen.getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByText(/\$4\.50/)).toBeInTheDocument();
    expect(screen.getByText(/3 scans/)).toBeInTheDocument();
  });

  it("prints an em dash, never $0.00, for a repository nothing could price", () => {
    const { container } = draw([repo({ fullName: "acme/own", estimatedCostUsd: null, unpricedCalls: 3 })]);
    expect(container.textContent).not.toContain("$0.00");
    const dash = screen.getByTitle(/not a measured zero/i);
    expect(dash.textContent).toBe("—");
  });

  it("says a priced figure is a floor when some of the repo's calls could not be priced", () => {
    draw([repo({ fullName: "acme/api", estimatedCostUsd: 4.5, unpricedCalls: 2 })]);
    expect(screen.getByText(/2 unpriced/)).toBeInTheDocument();
  });

  it("keeps work with no repository as a named row rather than dropping it", () => {
    draw([repo({ fullName: null, scans: 0, tokens: 0, calls: 6, estimatedCostUsd: 2 })]);
    expect(screen.getByText("Org-wide (no repo)")).toBeInTheDocument();
    // Not "0 scans": a repo-less lane has no billable scan to report, which is a different fact.
    expect(screen.getByText(/6 calls/)).toBeInTheDocument();
  });

  it("names the window and its UTC basis, like the panels above it", () => {
    const { container } = draw([repo({ fullName: "acme/api" })]);
    expect(container.textContent).toContain("last 30d (UTC)");
  });

  it("renders nothing at all when no repository was metered in the window", () => {
    const { container } = draw([]);
    expect(container.textContent).toBe("");
  });
});
