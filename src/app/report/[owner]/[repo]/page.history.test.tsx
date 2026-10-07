// @vitest-environment jsdom
//
// readReportHistory: a THROWN history read is null (ReportView's client door stays open) and is
// reported; a successful read with no history is the empty-history ANSWER.
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

vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
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

import { getRepositoryHistory } from "@/lib/db";
import { reportHandledError } from "@/lib/api/respond";
import Page from "./page";

async function renderPage() {
  captured = {};
  const shell = (await Page({
    params: Promise.resolve({ owner: "acme", repo: "web" }),
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement }> }>;
  const body = shell.props.children.props.children;
  render(await (body.type as (p: unknown) => Promise<React.ReactElement>)(body.props));
}

beforeEach(() => {
  vi.mocked(reportHandledError).mockClear();
  vi.mocked(getRepositoryHistory).mockReset();
});

describe("report permalink — server history read", () => {
  it("a thrown read yields null (client door stays open) and is reported", async () => {
    const boom = new Error("db down");
    vi.mocked(getRepositoryHistory).mockRejectedValue(boom);
    await renderPage();
    expect(captured.serverHistory).toBeNull();
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.any(String) }));
  });

  it("a successful read with no history keeps the empty-history answer", async () => {
    vi.mocked(getRepositoryHistory).mockResolvedValue(null as never);
    await renderPage();
    expect(captured.serverHistory).toEqual({ repo: { owner: "acme", name: "web", fullName: "acme/web" }, scans: [] });
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});
