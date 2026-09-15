// @vitest-environment jsdom
//
// UAT `SAM-L1-04` (recurrence 3) + `SAM-L1-12`. For three runs the scan ended on `/report?repo=…` and
// a whole-DOM sweep of the finished report found exactly one permalink-ish hit — a share-card PNG —
// while `/pricing` sold "Public report permalink" on the Free card. These pin the handover: the
// canonical `/report/{owner}/{repo}` address is ON the report, it is copyable, and it carries the level
// line that answers the job the retired README badge used to.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReportPermalinkShare, levelLine } from "./ReportPermalinkShare";

const open = () => fireEvent.click(screen.getByRole("button", { name: /permalink/i }));

describe("ReportPermalinkShare", () => {
  it("hands over the absolute canonical permalink, not the query-string URL the scan lands on", () => {
    render(
      <ReportPermalinkShare
        fullName="acme/web"
        path="/report/acme/web"
        level={levelLine("L3", "Managed", 62)}
      />,
    );
    open();
    const permalink = screen.getByLabelText(/^The permalink to the acme\/web report$/) as HTMLInputElement;
    // jsdom's origin. The value is absolute, and it is NOT the /report?repo= terminus.
    expect(permalink.value).toBe(`${window.location.origin}/report/acme/web`);
    expect(permalink.value).not.toContain("?repo=");
  });

  it("carries the level line, and a README-embeddable markdown link that states it", () => {
    render(
      <ReportPermalinkShare
        fullName="acme/web"
        path="/report/acme/web"
        level={levelLine("L3", "Managed", 62)}
      />,
    );
    open();
    // The claim, on screen — the thing Sam would stake his name on.
    expect(screen.getByText("L3 · Managed · 62")).toBeInTheDocument();
    const readme = screen.getByLabelText(/^The README markdown/i) as HTMLInputElement;
    expect(readme.value).toBe(`[Ascent: L3 · Managed · 62](${window.location.origin}/report/acme/web)`);
  });

  it("offers the commit-pinned URL as a SECOND line, keeping the unpinned one primary for a README", () => {
    render(
      <ReportPermalinkShare
        fullName="acme/web"
        path="/report/acme/web"
        pinnedPath="/report/acme/web@abc123"
        level={levelLine("L3", "Managed", 62)}
      />,
    );
    open();
    const pinned = screen.getByLabelText(/^The commit-pinned permalink/i) as HTMLInputElement;
    expect(pinned.value).toBe(`${window.location.origin}/report/acme/web@abc123`);
    // The README snippet must NOT pin: a README link pinned to one commit goes stale on the next push.
    expect((screen.getByLabelText(/^The README markdown/i) as HTMLInputElement).value).not.toContain("@abc123");
  });

  it("omits the commit line entirely when the scan has no head SHA", () => {
    render(<ReportPermalinkShare fullName="acme/web" path="/report/acme/web" level="L1 · Ad hoc · 20" />);
    open();
    expect(screen.queryByLabelText(/^The commit-pinned permalink/i)).toBeNull();
  });

  it("gives every row its own copy control with a distinct accessible name", () => {
    render(
      <ReportPermalinkShare
        fullName="acme/web"
        path="/report/acme/web"
        pinnedPath="/report/acme/web@abc123"
        level="L3 · Managed · 62"
      />,
    );
    open();
    const names = screen
      .getAllByRole("button", { name: /^Copy the /i })
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(3); // permalink / commit / README — three payloads, three names
  });

  it("stays collapsed until asked, so the export row keeps its shape", () => {
    render(<ReportPermalinkShare fullName="acme/web" path="/report/acme/web" level="L3 · Managed · 62" />);
    const toggle = screen.getByRole("button", { name: /permalink/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/^The permalink/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("levelLine", () => {
  it("renders the claim as `L3 · Managed · 62`", () => {
    expect(levelLine("L3", "Managed", 62)).toBe("L3 · Managed · 62");
  });
});

describe("the report's export row", () => {
  it("exposes the permalink control", async () => {
    const { ReportHeader } = await import("./ReportHeader");
    const report = {
      repo: {
        owner: "acme",
        name: "web",
        url: "https://github.com/acme/web",
        stars: 1,
        forks: 0,
        primaryLanguage: "TypeScript",
        pushedAt: "2026-01-01T00:00:00Z",
        headSha: "abc123",
        defaultBranch: "main",
      },
      archetype: "team",
      aiUsage: { detected: false, commitFraction: 0 },
      posture: { id: "ai-native", label: "AI-native", blurb: "b" },
      headline: "A capable team repo.",
      adoptionScore: 58,
      rigorScore: 64,
      strengths: [],
      risks: [],
      roadmap: [],
      engine: { provider: "claude-cli", model: "claude" },
      confidence: 0.9,
      scannedAt: "2026-01-01T00:00:00Z",
      overallScore: 62,
      level: { id: "L3", name: "Managed", band: [50, 69], tagline: "t", description: "d" },
      dimensions: [],
      discrepancies: [],
    } as never;
    render(<ReportHeader report={report} isMock={false} />);
    const row = screen.getByRole("button", { name: /permalink/i });
    fireEvent.click(row);
    expect(
      within(document.body).getByLabelText(/^The permalink to the acme\/web report$/),
    ).toHaveValue(`${window.location.origin}/report/acme/web`);
    // …pinned to the scanned commit on the second line, since this report has a head SHA.
    expect(screen.getByLabelText(/^The commit-pinned permalink/i)).toHaveValue(
      `${window.location.origin}/report/acme/web@abc123`,
    );
  });
});
