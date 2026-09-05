// @vitest-environment jsdom
// Pins the permalink's server-side data path (report-shell): /report/{owner}/{repo} already holds a DB
// session, so it composes the same readers /api/report/passport, /api/history and /api/recommendations
// serve and threads them into ReportView as props. With those props present the component must issue
// ZERO client fetches (the passport hero is then in the SSR HTML instead of popping in after paint);
// with them absent — the live-scan path through ReportClient — the original three fetches must still fire.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReportView } from "@/components/report/ReportView";
import type { AppPassport, ScanReport } from "@/lib/types";
import type { RepositoryHistory } from "@/lib/db/scans";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/report/acme/widget",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

function makeReport(): ScanReport {
  return {
    repo: {
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      stars: 1,
      forks: 0,
      defaultBranch: "main",
      primaryLanguage: "TypeScript",
    },
    overallScore: 72,
    level: { id: "L3", name: "Assisted", blurb: "b", range: [60, 79] },
    archetype: "team",
    adoptionScore: 65,
    rigorScore: 55,
    posture: { id: "ai-native", label: "AI-native", blurb: "b" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [],
    dimensions: [],
    headline: "Strong AI adoption with thin rigor.",
    strengths: [],
    risks: [],
    roadmap: [],
    discrepancies: [],
    confidence: 0.82,
    scannedAt: "2026-01-15T08:00:00.000Z",
    engine: { provider: "claude-cli", model: "test" },
  };
}

const history: RepositoryHistory = {
  repo: { owner: "acme", name: "widget", fullName: "acme/widget" },
  scans: [],
};

// Only the fields PassportHero reads — enough to prove the hero renders from the server prop alone.
const passport = {
  generatedAt: "2026-01-15",
  identity: { license: "MIT" },
  evidence: { source: "scan", confidence: 0.9 },
  stack: { languages: [], frameworks: [], persistence: [], integrations: [], hosting: null },
  automationReadiness: { level: "A2", score: 61 },
  productionReadiness: {
    band: "developing",
    score: 55,
    ci: { level: "basic" },
    tests: { level: "basic" },
    security: { level: "basic" },
    observability: { level: "none" },
    delivery: { migrations: "versioned", iac: false, rollback: false },
  },
} as unknown as AppPassport;

// The report's charts read prefers-reduced-motion through usePrefersReducedMotion (matchMedia), which
// jsdom doesn't implement. Stub a "motion allowed" media query so the tree renders.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => vi.unstubAllGlobals());

/** The three report-data endpoints only — the conversion CTA's unrelated /api/auth/viewer probe is
 *  not part of this contract and would otherwise make the counts brittle. */
function reportDataCalls(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => /^\/api\/(report\/passport|history|recommendations)/.test(u));
}

describe("ReportView — server-provided permalink data", () => {
  it("issues no passport/history/recommendations fetch when the server supplies them", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportView report={makeReport()} serverPassport={passport} serverHistory={history} serverRecs={[]} />);

    // The hero is present from the server prop — no fetch round-trip stood between paint and it.
    await waitFor(() => expect(screen.getByText("App Readiness Passport")).toBeTruthy());
    expect(reportDataCalls(fetchMock)).toEqual([]);
  });

  it("still fetches all three on the live-scan path, where no server props are passed", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      // 404 the passport (no stored one) so the hero simply doesn't render — this case is about the
      // requests going out, not about what comes back.
      String(url).startsWith("/api/report/passport")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ items: [], scans: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportView report={makeReport()} />);

    await waitFor(() => expect(reportDataCalls(fetchMock).length).toBe(3));
    const urls = reportDataCalls(fetchMock);
    expect(urls.some((u) => u.startsWith("/api/report/passport"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/history"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/recommendations"))).toBe(true);
  });
});
