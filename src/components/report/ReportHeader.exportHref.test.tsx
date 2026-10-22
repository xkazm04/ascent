// @vitest-environment jsdom
//
// export-0 (challenge-2026-10-22d): the header's export buttons fetch the report the page shows. On
// /report/acme/web?org=rebrand the page reads under 'rebrand' (canReadOrg-gated), so the PDF and
// share-card hrefs forward that hint; the export door re-gates it, so forwarding can never widen reach.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";

const search = vi.hoisted(() => ({ current: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.current) }));
vi.mock("@/components/report/SkillDownload", () => ({ SkillDownload: () => null }));

import { ReportHeader } from "./ReportHeader";

const REPORT = {
  repo: {
    owner: "acme",
    name: "app",
    url: "https://github.com/acme/app",
    stars: 1,
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
  overallScore: 61,
  level: { id: "L3", name: "Practicing", band: [50, 69], tagline: "t", description: "d" },
  adoptionScore: 58,
  rigorScore: 64,
  posture: { id: "ai-native", label: "AI-native", blurb: "b" },
  dimensions: [],
  headline: "h",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
} as unknown as ScanReport;

const hrefs = () => [
  screen.getByRole("link", { name: /export pdf/i }).getAttribute("href"),
  screen.getByRole("link", { name: /share card/i }).getAttribute("href"),
];

describe("ReportHeader export hrefs", () => {
  afterEach(() => {
    search.current = "";
  });

  it("forwards the page's ?org hint to the PDF and share-card exports", () => {
    search.current = "org=rebrand";
    render(<ReportHeader report={REPORT} isMock={false} />);
    expect(hrefs()).toEqual([
      "/api/report/pdf?repo=acme%2Fapp%40abc123&org=rebrand",
      "/api/report/share-card?repo=acme%2Fapp%40abc123&org=rebrand",
    ]);
  });

  it("guard: without an org param the hrefs are byte-identical to before", () => {
    render(<ReportHeader report={REPORT} isMock={false} />);
    expect(hrefs()).toEqual([
      "/api/report/pdf?repo=acme%2Fapp%40abc123",
      "/api/report/share-card?repo=acme%2Fapp%40abc123",
    ]);
  });
});
