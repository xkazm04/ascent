// @vitest-environment jsdom
//
// The permalink is the product's most-linked URL, and its claim travels further than the page: a
// Slack or GitHub unfurl renders generateMetadata's description and the opengraph artwork for
// readers who never open the app. These tests pin that the drift fact is threaded from the existing
// concurrent read batch (no GitHub call, no extra round trip), that the metadata dates a stale
// claim while leaving a current one byte-identical, and that the share card carries a scan date at
// all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const WEEK = 7 * 86_400_000;

const scanReport = {
  repo: { owner: "acme", name: "web", headSha: "abc1234" },
  level: { id: "L2", name: "Assisted" },
  overallScore: 50,
  scannedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
};

vi.mock("@/lib/db", () => ({
  getScanReportByCommit: vi.fn(async () => scanReport),
  getRepoPassport: vi.fn(async () => null),
  getSkillHistory: vi.fn(async () => []),
  getRepositoryHistory: vi.fn(async () => ({ repo: { owner: "acme", name: "web", fullName: "acme/web" }, scans: [] })),
  getLatestRecommendations: vi.fn(async () => ({ scanId: "s1", items: [] })),
  getHeadHint: vi.fn(async () => ({ headSha: "def5678", etag: null })),
  diffTrackSets: vi.fn(() => ({ added: [], dropped: [] })),
}));
// The window is MOCKED to an unmistakable value so the assertions prove the page READS
// scanMaxCacheAgeMs() rather than re-typing 7 days beside it.
vi.mock("@/lib/scan-cache", () => ({ scanMaxCacheAgeMs: vi.fn(() => WEEK) }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", isAuthConfigured: () => false, readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "dev" }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => false, canReadOrg: async () => true }));
vi.mock("@/lib/outcomes/expected-lift-load", () => ({ EMPTY_LIFTS: new Map(), getOrgExpectedLifts: vi.fn(async () => new Map()) }));

let captured: Record<string, unknown> = {};
vi.mock("@/components/report/ReportView", () => ({
  ReportView: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));
vi.mock("@/components/report/ReportShell", () => ({ ReportShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/report/ReportErrorBoundary", () => ({
  ReportErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/report/ReportClient", () => ({ ReportClient: () => null }));
vi.mock("@/features/standing/passports/PassportCard", () => ({ PassportCard: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

import { getHeadHint, getScanReportByCommit } from "@/lib/db";
import { scanMaxCacheAgeMs } from "@/lib/scan-cache";
import { ReportShareCard, ReportShareCardFallback } from "@/lib/og/report-card";
import Page, { generateMetadata } from "./page";

async function renderPage(repo = "web") {
  captured = {};
  const shell = (await Page({
    params: Promise.resolve({ owner: "acme", repo }),
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement }> }>;
  const body = shell.props.children.props.children;
  const resolved = await (body.type as (p: unknown) => Promise<React.ReactElement>)(body.props);
  render(resolved);
}

async function meta(repo = "web") {
  return generateMetadata({ params: Promise.resolve({ owner: "acme", repo }), searchParams: Promise.resolve({}) });
}

beforeEach(() => {
  vi.mocked(getScanReportByCommit).mockReset();
  vi.mocked(getScanReportByCommit).mockResolvedValue(scanReport as never);
  vi.mocked(getHeadHint).mockReset();
  vi.mocked(getHeadHint).mockResolvedValue({ headSha: "def5678", etag: null } as never);
  vi.mocked(scanMaxCacheAgeMs).mockReturnValue(WEEK);
});

describe("report permalink — the drift fact rides the existing concurrent read batch", () => {
  it("reads the remembered head hint once and threads it to the report body", async () => {
    await renderPage();
    expect(getHeadHint).toHaveBeenCalledTimes(1);
    expect(getHeadHint).toHaveBeenCalledWith("acme", "web", { orgSlug: "acme" });
    expect(captured.lastSeenHead).toBe("def5678");
    expect(captured.freshnessWindowMs).toBe(WEEK);
  });

  it("takes the belief window from scanMaxCacheAgeMs instead of re-typing it", async () => {
    vi.mocked(scanMaxCacheAgeMs).mockReturnValue(123_456);
    await renderPage();
    expect(captured.freshnessWindowMs).toBe(123_456);
  });

  it("leaves the control on today's output when the hint is absent", async () => {
    vi.mocked(getHeadHint).mockResolvedValue(null as never);
    await renderPage();
    expect(captured.lastSeenHead).toBeNull();
    expect(captured.report).toBe(scanReport);
  });

  it("leaves the control on today's output when the hint read fails", async () => {
    vi.mocked(getHeadHint).mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(captured.lastSeenHead).toBeNull();
    expect(captured.report).toBe(scanReport);
  });
});

describe("report permalink — generateMetadata dates a stale claim and leaves a current one alone", () => {
  it("is byte-identical to the undated description on a current reading", async () => {
    const m = await meta();
    expect(m.description).toBe(
      "acme/web scores 50/100 (L2 Assisted) on Ascent's AI-native maturity index.",
    );
  });

  it("appends an as-of date once the reading is past the belief window", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue({
      ...scanReport,
      scannedAt: "2025-08-01T00:00:00.000Z",
    } as never);
    const m = await meta();
    expect(String(m.description)).toContain("as of 2025-08-01");
    expect(String(m.description)).toMatch(/7-day window/i);
    expect(String(m.description)).toContain("scores 50/100");
    expect(String(m.description)).not.toContain("—");
    // The unfurl surfaces carry the same dated description, not a stale undated twin.
    expect(m.openGraph?.description).toBe(m.description);
    expect(m.twitter?.description).toBe(m.description);
  });

  it("says the scan date is not recorded rather than implying a present-tense claim", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue({ ...scanReport, scannedAt: undefined } as never);
    const m = await meta();
    expect(String(m.description)).toMatch(/scan date is not recorded/i);
  });

  it("still refuses to advertise a score for a cold permalink", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue(null as never);
    const m = await meta();
    expect(String(m.description)).toMatch(/has not been scanned on Ascent yet/i);
    expect(String(m.description)).not.toMatch(/as of/i);
  });
});

describe("share card — the unfurl artwork carries the scan date", () => {
  const card = {
    repo: { owner: "acme", name: "web" },
    level: { id: "L2", name: "Assisted" },
    overallScore: 50,
    adoptionScore: 40,
    rigorScore: 60,
    confidence: 0.9,
    engine: { provider: "claude", model: "sonnet" },
    dimensions: [{ id: "D1", score: 50 }],
    scannedAt: "2025-08-01T00:00:00.000Z",
  };

  it("prints the scan date so a stale reading cannot read as a present-tense fact", () => {
    render(<ReportShareCard report={card as never} />);
    expect(document.body.textContent ?? "").toContain("scanned 2025-08-01");
  });

  it("prints the date on an incomplete scan's card too", () => {
    render(<ReportShareCard report={{ ...card, dimensions: [] } as never} />);
    expect(document.body.textContent ?? "").toContain("scanned 2025-08-01");
  });

  it("states that the date is not recorded rather than omitting it", () => {
    render(<ReportShareCard report={{ ...card, scannedAt: undefined } as never} />);
    expect(document.body.textContent ?? "").toMatch(/scan date not recorded/i);
  });

  it("leaves the never-scanned fallback card unchanged", () => {
    render(<ReportShareCardFallback repoRef="acme/web" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("acme/web");
    expect(text).not.toMatch(/scanned 20/);
    expect(text).not.toMatch(/scan date not recorded/i);
  });
});

describe("report permalink — the pinned-commit eyebrow keeps its sha", () => {
  it("keeps the commit suffix in the description for a pinned permalink", async () => {
    const m = await meta("web@deadbeefcafe");
    expect(String(m.description)).toContain("at deadbee");
  });
});
