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
import { render, screen } from "@testing-library/react";

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
let coldGateRepo: string | undefined;
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/report/ColdScanGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/report/ColdScanGate")>();
  return {
    ...actual,
    ColdScanGate: ({ repo }: { repo: string }) => {
      coldGateRepo = repo;
      return <div data-testid="cold-scan-gate">{repo}</div>;
    },
  };
});
vi.mock("@/features/standing/passports/PassportCard", () => ({ PassportCard: () => null }));

let liveScanRepo: string | undefined;
vi.mock("@/components/report/ReportClient", () => ({
  ReportClient: ({ repo }: { repo?: string }) => {
    liveScanRepo = repo;
    return <div data-testid="fresh-retest" />;
  },
}));

import { getScanReportByCommit } from "@/lib/db";
import { getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import Page, { generateMetadata } from "./page";
import type { Metadata } from "next";

/** Resolve the page, then its Suspense-deferred async body, and render the result. */
async function renderPage(search: Record<string, string> = {}, repo = "web") {
  captured = {};
  liveScanRepo = undefined;
  coldGateRepo = undefined;
  const shell = (await Page({
    params: Promise.resolve({ owner: "acme", repo }),
    searchParams: Promise.resolve(search),
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

describe("report permalink — a failed read is not a never-scanned repo", () => {
  it("renders ReportView when a persisted snapshot exists", async () => {
    await renderPage();
    expect(captured.report).toBe(scanReport);
    expect(screen.queryByTestId("cold-scan-gate")).toBeNull();
    expect(screen.queryByTestId("permalink-read-error")).toBeNull();
  });

  it("renders ColdScanGate only on a successful empty lookup", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue(null);
    await renderPage();
    expect(screen.getByTestId("cold-scan-gate")).toBeInTheDocument();
    expect(coldGateRepo).toBe("acme/web");
    expect(screen.queryByTestId("permalink-read-error")).toBeNull();
    expect(captured.report).toBeUndefined();
  });

  it("renders an error card when the lookup throws — not ColdScanGate, not a live scan", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValue(new Error("token expired"));
    await renderPage();
    expect(screen.getByTestId("permalink-read-error")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /report unavailable for acme\/web/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^try again$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scan /i })).toBeNull();
    expect(screen.queryByTestId("cold-scan-gate")).toBeNull();
    expect(screen.queryByTestId("fresh-retest")).toBeNull();
    expect(captured.report).toBeUndefined();
    expect(getOrgExpectedLifts).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/could not load a scan for acme\/web/i);
    expect(text).not.toMatch(/no report yet/i);
    expect(text).not.toMatch(/has not been scanned/i);
    expect(text).not.toMatch(/scan acme\/web/i);
  });

  it("keeps a commit pin on the error card, still without inviting Scan now", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValue(new Error("dsql blip"));
    await renderPage({}, "web@deadbeef");
    expect(screen.getByRole("heading", { name: /report unavailable for acme\/web$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /scan /i })).toBeNull();
    expect(coldGateRepo).toBeUndefined();
  });
});

describe("report permalink — Re-test stays on the durable path", () => {
  it("?fresh=1 mounts a live re-test on this path instead of serving the pinned snapshot", async () => {
    await renderPage({ fresh: "1" });
    expect(screen.getByTestId("fresh-retest")).toBeInTheDocument();
    expect(liveScanRepo).toBe("acme/web");
    expect(captured.report).toBeUndefined();
    expect(getScanReportByCommit).not.toHaveBeenCalled();
  });

  it("commit-pinned ?fresh=1 keeps the sha on the live-scan ref", async () => {
    await renderPage({ fresh: "1" }, "web@deadbeef");
    expect(liveScanRepo).toBe("acme/web@deadbeef");
    expect(captured.report).toBeUndefined();
  });

  it("without ?fresh=1 still serves the pinned snapshot", async () => {
    await renderPage();
    expect(screen.queryByTestId("fresh-retest")).toBeNull();
    expect(captured.report).toBe(scanReport);
  });
});
