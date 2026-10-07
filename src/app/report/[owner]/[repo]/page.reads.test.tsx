// @vitest-environment jsdom
//
// robustness-1 / robustness-4 (council r2): every server read on the permalink keeps a FAILED read
// distinguishable from the store's empty answer, and every failure reaches a door.
//
// Before: getSkillHistory(...).catch(() => []) hid the section as if no skill was ever generated;
// getRepoPassport(...).catch(() => null) told ReportView the server PROVED there is no passport, so it
// skipped its own fetch; getLatestRecommendations(...).catch(() => null) became items [] — a "real
// answer" ReportView never refetches; and the thrown report read reached the user but nobody else.
// None of them logged. These tests make each read throw and pin the failure state AND the report;
// each has an answer twin pinning that a genuinely empty store still reads as empty.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const scanReport = {
  repo: { owner: "acme", name: "web", headSha: "abc1234" },
  level: { id: "L2", name: "Assisted" },
  overallScore: 50,
  scannedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
};
const recItems = [{ id: "r1", title: "Adopt review checklist", dimension: "D2" }];
const skillRows = [{ id: "g1", repoFullName: "acme/web", headSha: "abc1234", trackIds: ["agent-docs"], generatedAt: "2026-10-01T00:00:00.000Z" }];

const h = vi.hoisted(() => ({ canReadOrg: vi.fn(async () => true), hasOrgRole: vi.fn(async () => false) }));

vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getScanReportByCommit: vi.fn(),
  getRepoPassport: vi.fn(),
  getSkillHistory: vi.fn(),
  getRepositoryHistory: vi.fn(async () => ({ repo: { owner: "acme", name: "web", fullName: "acme/web" }, scans: [] })),
  getLatestRecommendations: vi.fn(),
  getHeadHint: vi.fn(),
  diffTrackSets: vi.fn(() => ({ added: [], dropped: [] })),
}));
vi.mock("@/lib/scan-cache", () => ({ scanMaxCacheAgeMs: vi.fn(() => 7 * 86_400_000) }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", isAuthConfigured: () => false, readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "dev" }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: h.hasOrgRole, canReadOrg: h.canReadOrg }));
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
vi.mock("@/components/report/ColdScanGate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/report/ColdScanGate")>()),
  ColdScanGate: () => <div data-testid="cold-scan-gate" />,
}));
vi.mock("@/features/standing/passports/PassportCard", () => ({ PassportCard: () => <div data-testid="passport-card" /> }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

import {
  getScanReportByCommit,
  getRepoPassport,
  getSkillHistory,
  getLatestRecommendations,
  getHeadHint,
} from "@/lib/db";
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

/** The door was reached for THIS read: reportHandledError got the very error, named by the read. */
function expectReported(err: Error, read: RegExp) {
  expect(reportHandledError).toHaveBeenCalledWith(err, expect.objectContaining({ message: expect.stringMatching(read) }));
}

beforeEach(() => {
  vi.mocked(reportHandledError).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getScanReportByCommit).mockReset().mockResolvedValue(scanReport as never);
  vi.mocked(getRepoPassport).mockReset().mockResolvedValue(null);
  vi.mocked(getSkillHistory).mockReset().mockResolvedValue([]);
  vi.mocked(getLatestRecommendations).mockReset().mockResolvedValue({ scanId: "s1", items: recItems } as never);
  vi.mocked(getHeadHint).mockReset().mockResolvedValue({ headSha: "def5678", etag: null });
  h.canReadOrg.mockReset().mockResolvedValue(true);
  h.hasOrgRole.mockReset().mockResolvedValue(false);
});

describe("permalink report read — robustness-4", () => {
  it("a thrown read renders PermalinkReadError AND is reported (it used to reach the user only)", async () => {
    const boom = new Error("dsql blip");
    vi.mocked(getScanReportByCommit).mockRejectedValue(boom);
    await renderPage();
    expect(screen.getByTestId("permalink-read-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cold-scan-gate")).toBeNull();
    expectReported(boom, /getScanReportByCommit/);
    expect(console.error).toHaveBeenCalled();
  });

  it("reads the report strictly, so an unreachable DB throws instead of reading as never-scanned", async () => {
    await renderPage();
    expect(getScanReportByCommit).toHaveBeenCalledWith("acme", "web", expect.objectContaining({ strict: true }));
  });
});

describe("skill history — a failed read is not 'never generated'", () => {
  it("a thrown read says it could not load, and is reported", async () => {
    const boom = new Error("skill table unreachable");
    vi.mocked(getSkillHistory).mockRejectedValue(boom);
    await renderPage();
    expect(screen.getByTestId("skill-history-unavailable")).toHaveTextContent(/couldn't load the skill history/i);
    expectReported(boom, /getSkillHistory/);
  });

  it("an empty answer hides the section, with no notice and no report", async () => {
    await renderPage();
    expect(screen.queryByTestId("skill-history-unavailable")).toBeNull();
    expect(screen.queryByText(/onboarding skill/i)).toBeNull();
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("rows render the panel", async () => {
    vi.mocked(getSkillHistory).mockResolvedValue(skillRows);
    await renderPage();
    expect(screen.getByText(/generated 1×/)).toBeInTheDocument();
  });
});

describe("passport — a failed read leaves the prop unresolved for ReportView's own fetch", () => {
  it("a thrown read is undefined (not null, which would skip the client fetch), and is reported", async () => {
    const boom = new Error("passport read failed");
    vi.mocked(getRepoPassport).mockRejectedValue(boom);
    await renderPage();
    expect("serverPassport" in captured).toBe(true);
    expect(captured.serverPassport).toBeUndefined();
    expect(screen.queryByTestId("passport-card")).toBeNull();
    expectReported(boom, /getRepoPassport/);
  });

  it("the store's answer 'no passport' stays null", async () => {
    await renderPage();
    expect(captured.serverPassport).toBeNull();
    expect(getRepoPassport).toHaveBeenCalledWith("acme", "web", expect.objectContaining({ strict: true }));
  });
});

describe("recommendations — a failed read is not an empty roadmap", () => {
  it("a thrown read leaves serverRecs undefined (ReportView refetches) and is reported", async () => {
    const boom = new Error("recs read failed");
    vi.mocked(getLatestRecommendations).mockRejectedValue(boom);
    await renderPage();
    expect(captured.serverRecs).toBeUndefined();
    expectReported(boom, /getLatestRecommendations/);
  });

  it("a thrown access check does not fall back to the public org's empty list", async () => {
    const boom = new Error("authz backend down");
    h.canReadOrg.mockRejectedValue(boom);
    await renderPage();
    expect(captured.serverRecs).toBeUndefined();
    expect(captured.serverLifts).toBeUndefined();
    expect(getLatestRecommendations).not.toHaveBeenCalled();
    expectReported(boom, /canReadOrg/);
  });

  it("no persisted scan (null) is the real answer []", async () => {
    vi.mocked(getLatestRecommendations).mockResolvedValue(null);
    await renderPage();
    expect(captured.serverRecs).toEqual([]);
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("rows pass through, read strictly", async () => {
    await renderPage();
    expect(captured.serverRecs).toEqual(recItems);
    expect(getLatestRecommendations).toHaveBeenCalledWith("acme", "web", expect.objectContaining({ strict: true }));
  });
});

describe("best-effort reads on the permalink keep their degrade and reach a door (class B)", () => {
  it("a thrown head hint is the no-claim answer (null), reported", async () => {
    const boom = new Error("head hint read failed");
    vi.mocked(getHeadHint).mockRejectedValue(boom);
    await renderPage();
    expect(captured.lastSeenHead).toBeNull();
    expectReported(boom, /getHeadHint/);
  });

  it("a thrown role probe fails closed (no foundation button), reported", async () => {
    const boom = new Error("membership read failed");
    h.hasOrgRole.mockRejectedValue(boom);
    await renderPage();
    expect(captured.installFoundation).toBe(false);
    expectReported(boom, /hasOrgRole\(member\)/);
  });
});
