// @vitest-environment jsdom
//
// Pins repo-report-shell-tabs #6 / pdf-llm-export #6 (same on-screen surface): a long unbroken
// owner/name in the report H1 breaks/wraps within a min-w-0 column instead of overflowing the header
// on a narrow (mobile) viewport.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";
import { ReportHeader } from "./ReportHeader";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";

// Minimal cast — the header reads repo/archetype/aiUsage/engine/confidence/scannedAt, plus (since
// G5-17) the score/level/dimension fields the "Copy for LLM" payload is rendered from.
function report(owner: string, engine?: Partial<ScanReport["engine"]>): ScanReport {
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
    engine: { provider: "anthropic", model: "claude", ...engine },
    confidence: 0.9,
    scannedAt: "2026-01-01T00:00:00Z",
    overallScore: 61,
    level: { id: "L3", name: "Practicing", band: [50, 69], tagline: "t", description: "d" },
    adoptionScore: 58,
    rigorScore: 64,
    posture: { id: "ai-native", label: "AI-native", blurb: "b" },
    dimensions: [
      {
        id: "D1",
        name: "Context Engineering",
        weight: 0.15,
        score: 70,
        signalScore: 66,
        llmScore: 74,
        summary: "solid",
        evidence: [],
        strengths: [],
        gaps: ["no per-package context"],
      },
    ],
    headline: "A capable team repo.",
    strengths: ["CI is fast"],
    risks: ["thin tests"],
    roadmap: [],
    discrepancies: [],
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

  // The Bedrock privacy chip used to render the IDENTICAL "in-account" claim whether the scan ran on
  // the org's own connected Bedrock (BYOM) or on Ascent's platform Bedrock account. The AWS
  // guarantees hold either way; "in-account" does not. engine.byom is the only distinguisher, and a
  // legacy row that predates the flag is UNKNOWN — which must read as the platform wording.
  describe("Bedrock privacy chip — whose account", () => {
    const chip = () => screen.getByText(/inference · AWS Bedrock/);

    it("claims the customer's OWN account only when engine.byom is true", () => {
      render(<ReportHeader report={report("acme", { provider: "bedrock", model: "claude-sonnet-4-6", byom: true })} isMock={false} />);
      expect(chip()).toHaveTextContent("AWS Bedrock · your account");
      const hint = chip().getAttribute("title")!;
      expect(hint).toMatch(/YOUR org's own AWS account/);
      expect(hint).toMatch(/never used for training/);
      // The sr-only copy must carry the same hint (hover-only tooltips are not accessible).
      expect(chip()).toHaveTextContent(hint);
    });

    it("uses accurate platform wording when byom is false, keeping the AWS boundary/no-training claims", () => {
      render(<ReportHeader report={report("acme", { provider: "bedrock", model: "claude-sonnet-4-6", byom: false })} isMock={false} />);
      expect(chip()).not.toHaveTextContent("AWS Bedrock · your account");
      const hint = chip().getAttribute("title")!;
      expect(hint).toMatch(/Ascent's AWS account/);
      expect(hint).toMatch(/within the AWS boundary/);
      expect(hint).toMatch(/never used for training/);
      expect(hint).not.toMatch(/in-account/);
    });

    it("treats a legacy row (byom undefined) as the platform case, never as the customer's account", () => {
      render(<ReportHeader report={report("acme", { provider: "bedrock", model: "claude-sonnet-4-6" })} isMock={false} />);
      expect(chip()).not.toHaveTextContent("AWS Bedrock · your account");
      expect(chip().getAttribute("title")).toMatch(/Ascent's AWS account/);
    });
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

  // G5-17 — the UI half of the "one generator" proof. The chip's payload is not inspectable directly
  // (it goes to the clipboard), so both copy paths are forced to fail: the manual-copy textarea then
  // holds the EXACT bytes the button would have copied. Those bytes must equal reportLlmMarkdown(),
  // which src/app/api/report/llm/route.test.ts independently asserts is the endpoint's body — so a
  // format change that reached only one surface fails one of the two tests.
  it("G5-17: the Copy-for-LLM chip carries exactly reportLlmMarkdown(report)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
      configurable: true,
    });
    (document as unknown as { execCommand: () => boolean }).execCommand = vi.fn(() => false);

    const r = report("acme");
    render(<ReportHeader report={r} isMock={false} />);
    fireEvent.click(screen.getByRole("button", { name: /copy the acme\/web maturity briefing/i }));

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Markdown briefing to copy manually");
    expect(ta.value).toBe(reportLlmMarkdown(r));
    expect(ta.value).toContain("# Ascent maturity report — acme/web"); // and it is the real briefing
  });

  // G1-36: PDF export is a Pro-plan+ entitlement (planAllowsPdfExport) — a Free-tier org's click
  // 403s. The header has no plan/tier data to hide the button ahead of time, so the button stays
  // visible, but a 403 must not dead-end on inert error text: it has to offer a real way forward.
  it("G1-36: a 403 (Free-tier org, no PDF entitlement) links to /pricing instead of dead-ending", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "PDF export is a Pro-plan feature." }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportHeader report={report("acme")} isMock={false} />);
    const link = screen.getByRole("link", { name: /export pdf/i });
    fireEvent.click(link);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PDF export is a Pro-plan feature.");
    expect(alert).toHaveTextContent("Upgrade");
    expect(alert).toHaveAttribute("href", "/pricing");
  });

  it("G5-04: offers the share card as a download of the SAME image the permalink unfurls", () => {
    render(<ReportHeader report={report("acme")} isMock={false} />);
    const link = screen.getByRole("link", { name: /share card/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("/api/report/share-card?repo="));
    expect(link.getAttribute("href")).toContain(encodeURIComponent("acme/web@abc123"));
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
