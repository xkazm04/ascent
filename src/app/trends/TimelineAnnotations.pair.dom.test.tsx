// @vitest-environment jsdom
// Pins the "what changed" link on each timeline event (trends-1): an event with a real baseline opens
// its own pair diff on the compare page; an event with no real baseline offers no link.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineAnnotations } from "@/app/trends/TimelineAnnotations";
import type { TrendAnnotation } from "@/app/trends/annotations";

const SHA = "c".repeat(40);

const regression: TrendAnnotation = {
  at: "2026-09-20T00:00:00.000Z",
  scanId: "s3",
  prevScanId: "s2",
  kind: "regression",
  label: "-7",
  detail: "Regression: overall score fell 7 points from 67 to 60.",
  delta: -7,
  sha: SHA.slice(0, 7),
  commitSha: SHA,
};

const rubric: TrendAnnotation = {
  ...regression,
  at: "2026-09-10T00:00:00.000Z",
  scanId: "s2",
  prevScanId: "s1",
  kind: "rubric",
  label: "r9 -> r10",
  detail: "Scoring rubric changed from r9 to r10.",
};

describe("TimelineAnnotations what-changed link", () => {
  it("links a regression with a baseline to its pair diff", () => {
    render(<TimelineAnnotations annotations={[regression]} repoFullName="acme/app" />);
    const link = screen.getByRole("link", { name: /what changed/i });
    expect(link.getAttribute("href")).toBe("/report/compare?repo=acme%2Fapp&a=s3&b=s2");
    expect(link.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("links a rubric marker too: the compare page's ruler note explains the move", () => {
    render(<TimelineAnnotations annotations={[rubric]} repoFullName="acme/app" />);
    expect(screen.getByRole("link", { name: /what changed/i }).getAttribute("href")).toBe(
      "/report/compare?repo=acme%2Fapp&a=s2&b=s1",
    );
  });

  it("renders no what-changed link when the marker has no real baseline", () => {
    render(<TimelineAnnotations annotations={[{ ...regression, prevScanId: null }]} repoFullName="acme/app" />);
    expect(screen.queryByRole("link", { name: /what changed/i })).not.toBeInTheDocument();
    // The single-scan report link is unchanged.
    expect(screen.getByRole("link", { name: "report" })).toBeInTheDocument();
  });
});
