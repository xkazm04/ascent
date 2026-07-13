// @vitest-environment jsdom
//
// Pins repo-report-shell-tabs #6 / pdf-llm-export #6 (same on-screen surface): a long unbroken
// owner/name in the report H1 breaks/wraps within a min-w-0 column instead of overflowing the header
// on a narrow (mobile) viewport.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";
import { ReportHeader } from "./ReportHeader";

// Minimal cast — ReportHeader + FreshnessControl only read repo/archetype/aiUsage/engine/confidence/scannedAt.
function report(owner: string): ScanReport {
  return {
    repo: {
      owner,
      name: "web",
      url: "https://github.com/x/web",
      stars: 12,
      forks: 0,
      primaryLanguage: "TypeScript",
      pushedAt: "2026-01-01T00:00:00Z",
      headSha: "abc123",
      defaultBranch: "main",
    },
    archetype: "team",
    aiUsage: { detected: false, commitFraction: 0 },
    engine: { provider: "anthropic", model: "claude" },
    confidence: 0.9,
    scannedAt: "2026-01-01T00:00:00Z",
  } as unknown as ScanReport;
}

describe("ReportHeader", () => {
  it("#6: breaks a long owner/name in the H1 inside a min-w-0 column", () => {
    render(<ReportHeader report={report("a".repeat(120))} isMock={false} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("break-words");
    expect(h1.parentElement).toHaveClass("min-w-0"); // the flex column must be able to shrink
  });
});
