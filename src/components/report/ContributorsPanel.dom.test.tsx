// @vitest-environment jsdom
// Pins the Contributors tab's exploration affordances (report-shell): the panel used to hard-cap at
// the top 8 with no count of what it dropped, no way to see the rest, and no route from a name to a
// person. It must now disclose the hidden tail, reveal it on request, and link real GitHub logins out.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContributorsPanel } from "@/components/report/ContributorsPanel";
import type { Contributor, ScanReport } from "@/lib/types";

function people(n: number): Contributor[] {
  return Array.from({ length: n }, (_, i) => ({
    login: `dev-${i}`,
    commits: 10,
    aiCommits: i,
  }));
}

function makeReport(contributors: Contributor[]): ScanReport {
  return { contributors } as unknown as ScanReport;
}

describe("ContributorsPanel", () => {
  it("discloses the hidden tail and reveals it on request", () => {
    render(<ContributorsPanel report={makeReport(people(37))} />);

    expect(screen.getByText("8/37 shown")).toBeTruthy();
    expect(screen.queryByText("dev-30")).toBeNull();

    const more = screen.getByRole("button", { name: "Show 29 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);

    expect(screen.getByText("37/37 shown")).toBeTruthy();
    expect(screen.getByText("dev-30")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show top 8" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("offers no reveal when nothing is hidden", () => {
    render(<ContributorsPanel report={makeReport(people(3))} />);
    expect(screen.getByText("3/3 shown")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("links GitHub logins out, and leaves un-resolved commit-author names as plain text", () => {
    render(
      <ContributorsPanel
        report={makeReport([
          { login: "octocat", commits: 4, aiCommits: 2 },
          { login: "Ada Lovelace", commits: 2, aiCommits: 0 },
          { login: "unknown", commits: 9, aiCommits: 9 },
        ])}
      />,
    );

    const link = screen.getByRole("link", { name: "octocat" });
    expect(link.getAttribute("href")).toBe("https://github.com/octocat");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ada Lovelace" })).toBeNull();
    // "unknown" is the no-author placeholder and is filtered out entirely.
    expect(screen.queryByText("unknown")).toBeNull();
    expect(screen.getByText("2/2 shown")).toBeTruthy();
  });

  it("says so when the list is sitting on the stored per-scan cap", () => {
    const { rerender } = render(<ContributorsPanel report={makeReport(people(12))} />);
    expect(screen.queryByText(/50 most active/)).toBeNull();

    rerender(<ContributorsPanel report={makeReport(people(50))} />);
    expect(screen.getByText(/50 most active/)).toBeTruthy();
  });
});
