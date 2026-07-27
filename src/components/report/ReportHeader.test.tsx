// @vitest-environment jsdom
//
// Pins repo-report-shell-tabs #6 / pdf-llm-export #6 (same on-screen surface): a long unbroken
// owner/name in the report H1 breaks/wraps within a min-w-0 column instead of overflowing the header
// on a narrow (mobile) viewport.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("#6: breaks a long owner/name in the H1 inside a min-w-0 column", () => {
    render(<ReportHeader report={report("a".repeat(120))} isMock={false} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("break-words");
    expect(h1.parentElement).toHaveClass("min-w-0"); // the flex column must be able to shrink
  });

  // Pins pdf-llm-export #1: "Export PDF" must not be a bare navigation anchor. A failed export
  // (404/503/500 → JSON body) has to surface its error INLINE and keep the user on the report page,
  // and while the CPU-bound render runs the button must show a busy state instead of nothing.
  it("pdf-llm-export #1: a failed PDF export shows an inline alert instead of navigating to raw JSON", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "No report for this repo yet — scan it first." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportHeader report={report("acme")} isMock={false} />);
    const link = screen.getByRole("link", { name: /export pdf/i });
    fireEvent.click(link); // plain left-click is intercepted (no navigation)

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No report for this repo yet — scan it first.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/report/pdf?repo=");
  });

  it("pdf-llm-export #1: the export button shows a busy state while the render is in flight and ignores re-clicks", async () => {
    const fetchMock = vi.fn(() => new Promise(() => {})); // never resolves — render in progress
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportHeader report={report("acme")} isMock={false} />);
    const link = screen.getByRole("link", { name: /export pdf/i });
    fireEvent.click(link);

    const busy = await screen.findByText(/preparing…/i);
    expect(busy.closest("a")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("link", { name: /preparing/i })); // re-click must not re-render the PDF
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
