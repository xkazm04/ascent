// @vitest-environment jsdom
//
// D9: the server read that makes the roadmap's measured basis reachable at all.
//
// `getOrgExpectedLifts` existed, was tested, and had exactly one caller: GET /api/recommendations.
// The permalink page — the surface every persistence-enabled org actually reads — never called it, so
// `ExpectedLiftBasis` (mounted in both roadmap renderings) and the measured sort toggle could not
// render in-app no matter how full the ledger was. These tests pin the read, the org it is scoped to,
// and the degrade path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const scanReport = { repo: { owner: "acme", name: "web" }, level: { id: "L2", name: "Assisted" }, overallScore: 50 };
const recItems = [{ id: "r1", title: "Adopt review checklist", dimension: "D2" }];

vi.mock("@/lib/db", () => ({
  getScanReportByCommit: vi.fn(async () => scanReport),
  getRepoPassport: vi.fn(async () => null),
  getSkillHistory: vi.fn(async () => []),
  getRepositoryHistory: vi.fn(async () => ({ repo: { owner: "acme", name: "web", fullName: "acme/web" }, scans: [] })),
  getLatestRecommendations: vi.fn(async () => ({ scanId: "s1", items: recItems })),
  diffTrackSets: vi.fn(() => ({ added: [], dropped: [] })),
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", isAuthConfigured: () => false, readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "dev" }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => false, canReadOrg: async () => true }));
vi.mock("@/lib/outcomes/expected-lift-load", () => ({ EMPTY_LIFTS: new Map(), getOrgExpectedLifts: vi.fn() }));

// The report body is the assertion target: a recording stub captures the props the page threads down.
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
vi.mock("@/components/report/ColdScanGate", () => ({ ColdScanGate: () => null }));
vi.mock("@/features/standing/passports/PassportCard", () => ({ PassportCard: () => null }));

import { getScanReportByCommit } from "@/lib/db";
import { getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import Page, { generateMetadata } from "./page";
import type { Metadata } from "next";

/** Resolve the page, then its Suspense-deferred async body, and render the result. */
async function renderPage() {
  captured = {};
  const shell = (await Page({
    params: Promise.resolve({ owner: "acme", repo: "web" }),
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement }> }>;
  const body = shell.props.children.props.children;
  const resolved = await (body.type as (p: unknown) => Promise<React.ReactElement>)(body.props);
  render(resolved);
}

const lifts = new Map([["D2::x", { identityKey: "D2::x", n: 5 }]]);

beforeEach(() => {
  vi.mocked(getOrgExpectedLifts).mockReset();
  vi.mocked(getOrgExpectedLifts).mockResolvedValue(lifts as never);
  vi.mocked(getScanReportByCommit).mockReset();
  vi.mocked(getScanReportByCommit).mockResolvedValue(scanReport as never);
});

describe("report permalink — the lift map reaches the roadmap", () => {
  it("reads the org's lifts once and hands them to ReportView beside the recommendations", async () => {
    await renderPage();
    expect(getOrgExpectedLifts).toHaveBeenCalledTimes(1);
    expect(captured.serverLifts).toBe(lifts);
    expect(captured.serverRecs).toEqual(recItems);
  });

  it("scopes the read to the SAME org the recommendations were read under", async () => {
    await renderPage();
    // canReadOrg(owner) passes here, so both reads use the owner org — never a mix of two tenants.
    expect(getOrgExpectedLifts).toHaveBeenCalledWith("acme");
  });

  it("degrades to no map when the ledger read fails — never a partial or fabricated basis", async () => {
    vi.mocked(getOrgExpectedLifts).mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(captured.serverLifts).toEqual(new Map());
    expect(captured.serverRecs).toEqual(recItems); // the roadmap itself still renders
  });
});

function metaArgs(repo = "web") {
  return {
    params: Promise.resolve({ owner: "acme", repo }),
    searchParams: Promise.resolve({}),
  };
}

function advertised(meta: Metadata): string {
  return [
    meta.title,
    meta.description,
    meta.openGraph?.title,
    meta.openGraph?.description,
    meta.twitter?.title,
    meta.twitter?.description,
  ]
    .map(String)
    .join("\n");
}

const SCORED_UNFURL = /AI-native maturity|scores \d+\/100|with evidence|route to the next level/i;

describe("report permalink — generateMetadata does not advertise a cold report", () => {
  it("unfurls the score and level only when a persisted snapshot exists", async () => {
    const meta = await generateMetadata(metaArgs());
    const text = advertised(meta);
    expect(text).toContain("acme/web: L2 Assisted");
    expect(text).toContain("scores 50/100");
    expect(text).toContain("L2 Assisted");
  });

  it("does not claim a scored maturity report when the permalink is cold", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue(null);
    const meta = await generateMetadata(metaArgs());
    const text = advertised(meta);
    expect(text).toMatch(/no report yet for acme\/web/i);
    expect(text).toMatch(/has not been scanned on Ascent yet/i);
    expect(text).not.toMatch(SCORED_UNFURL);
    expect(text).not.toMatch(/never been scanned/i);
    expect(meta.title).toBe(meta.openGraph?.title);
    expect(meta.description).toBe(meta.openGraph?.description);
    expect(meta.title).toBe(meta.twitter?.title);
    expect(meta.description).toBe(meta.twitter?.description);
  });

  it("does not treat a thrown lookup as never-scanned, and still does not advertise a score", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValue(new Error("token expired"));
    const meta = await generateMetadata(metaArgs());
    const text = advertised(meta);
    expect(text).toMatch(/report unavailable/i);
    expect(text).toMatch(/could not load/i);
    expect(text).not.toMatch(/no report yet/i);
    expect(text).not.toMatch(/has not been scanned/i);
    expect(text).not.toMatch(/never been scanned/i);
    expect(text).not.toMatch(SCORED_UNFURL);
  });
});
