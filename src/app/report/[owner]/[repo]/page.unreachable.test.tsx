// @vitest-environment jsdom
//
// robustness-2 (council r2): the permalink's declared failure mode — "a blip is not 'never scanned'"
// (G4) — must hold for the DB-UNREACHABLE class too, not only for a read that throws.
//
// The reader beneath the page wraps its query in dbReadSafe, which RESOLVES null (it does not throw)
// when the database is configured but unreachable. The page mapped that null to "empty", so an outage
// rendered ColdScanGate ("This repository hasn't been scanned on Ascent yet" + Scan now). The earlier
// tests could not see it: they mocked @/lib/db wholesale and made the reader REJECT. These run the
// REAL readers (scans-read.ts, skill-history.ts) over the REAL client wrappers (dbReadSafe /
// dbReadStrict); the only fake is the Prisma client, whose every query throws an unreachable-class
// error in the two shapes isDbUnavailableError recognises.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  configured: true,
  prisma: null as unknown,
  /** When set, the page's REPORT read is served from here so the sibling reads hit the outage. */
  report: null as unknown,
}));

vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/client")>()),
  isDbConfigured: () => h.configured,
  getPrisma: () => h.prisma,
}));
// NOT a rejecting stub: the page's db barrel resolves to the real reader functions.
vi.mock("@/lib/db", async () => {
  const read = await vi.importActual<typeof import("@/lib/db/scans-read")>("@/lib/db/scans-read");
  const skills = await vi.importActual<typeof import("@/lib/db/skill-history")>("@/lib/db/skill-history");
  return {
    getScanReportByCommit: (...args: Parameters<typeof read.getScanReportByCommit>) =>
      h.report ? Promise.resolve(h.report) : read.getScanReportByCommit(...args),
    getRepositoryHistory: read.getRepositoryHistory,
    getRepoPassport: read.getRepoPassport,
    getLatestRecommendations: read.getLatestRecommendations,
    getHeadHint: read.getHeadHint,
    getSkillHistory: skills.getSkillHistory,
    diffTrackSets: skills.diffTrackSets,
  };
});
vi.mock("@/lib/scan-cache", () => ({ scanMaxCacheAgeMs: vi.fn(() => 7 * 86_400_000) }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", isAuthConfigured: () => false, readableOrgForOwner: async () => "acme" }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: async () => "dev" }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => false, canReadOrg: async () => true }));
vi.mock("@/lib/outcomes/expected-lift-load", () => ({ EMPTY_LIFTS: new Map(), getOrgExpectedLifts: vi.fn(async () => new Map()) }));

let captured: Record<string, unknown> | null = null;
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
  ColdScanGate: () => <div data-testid="cold-scan-gate">No report yet. Scan now</div>,
}));
vi.mock("@/features/standing/passports/PassportCard", () => ({ PassportCard: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

import { reportHandledError } from "@/lib/api/respond";
import { getScanReportByCommit as realGetScanReportByCommit } from "@/lib/db/scans-read";
import Page, { generateMetadata } from "./page";

/** The two unreachable shapes isDbUnavailableError recognises (src/lib/db/client.ts). */
const UNREACHABLE: [string, () => Error][] = [
  ["engine: PrismaClientInitializationError \"Can't reach database server\"", () =>
    Object.assign(new Error("Can't reach database server at `db.internal:5432`"), { name: "PrismaClientInitializationError" })],
  ["driver adapter: errno ECONNREFUSED on an empty-bodied request error", () =>
    Object.assign(new Error("Invalid `prisma.organization.findUnique()` invocation:"), { name: "PrismaClientKnownRequestError", code: "ECONNREFUSED" })],
];

/** A Prisma client whose every `model.method()` throws `make()`. */
function prismaThrowing(make: () => Error) {
  const method = async () => {
    throw make();
  };
  return new Proxy({}, { get: () => new Proxy({}, { get: () => method }) });
}

async function renderPage() {
  captured = null;
  const shell = (await Page({
    params: Promise.resolve({ owner: "acme", repo: "web" }),
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactElement }> }>;
  const body = shell.props.children.props.children;
  render(await (body.type as (p: unknown) => Promise<React.ReactElement>)(body.props));
}

function reportedMessages(): string[] {
  return vi.mocked(reportHandledError).mock.calls.map(([, ctx]) => (ctx as { message: string }).message);
}

beforeEach(() => {
  h.configured = true;
  h.report = null;
  h.prisma = null;
  vi.mocked(reportHandledError).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("permalink on a configured-but-unreachable DB (real readers, real client wrappers)", () => {
  it.each(UNREACHABLE)("%s → PermalinkReadError, never ColdScanGate", async (_label, make) => {
    h.prisma = prismaThrowing(make);
    await renderPage();
    expect(screen.getByTestId("permalink-read-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cold-scan-gate")).toBeNull();
    expect(screen.queryByRole("button", { name: /scan /i })).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/could not load a scan for acme\/web/i);
    expect(text).not.toMatch(/hasn't been scanned|no report yet/i);
    // The door: the typed DbUnavailableError reached telemetry, carrying the driver error as cause.
    const [err] = vi.mocked(reportHandledError).mock.calls[0]!;
    expect((err as Error).name).toBe("DbUnavailableError");
    expect(((err as Error).cause as Error).message).toBe(make().message);
  });

  it.each(UNREACHABLE)("%s → the unfurl says 'report unavailable', not 'no report yet'", async (_label, make) => {
    h.prisma = prismaThrowing(make);
    const meta = await generateMetadata({ params: Promise.resolve({ owner: "acme", repo: "web" }), searchParams: Promise.resolve({}) });
    const text = `${String(meta.title)}\n${String(meta.description)}`;
    expect(text).toMatch(/report unavailable/i);
    expect(text).not.toMatch(/no report yet|has not been scanned/i);
  });

  it("the DEFAULT (non-strict) reader still degrades the same outage to null — dbReadSafe is unchanged for its other callers", async () => {
    h.prisma = prismaThrowing(UNREACHABLE[0]![1]);
    await expect(realGetScanReportByCommit("acme", "web", { orgSlug: "acme" })).resolves.toBeNull();
  });

  it("a reader that REJECTS (a live-DB query error) is PermalinkReadError too", async () => {
    h.prisma = prismaThrowing(() => new Error('column "headSha" does not exist'));
    await renderPage();
    expect(screen.getByTestId("permalink-read-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cold-scan-gate")).toBeNull();
    expect(reportedMessages()).toContain("report permalink: getScanReportByCommit failed");
  });

  it("an UNCONFIGURED database is the keyless MVP: the empty lookup still shows the cold gate", async () => {
    h.configured = false;
    await renderPage();
    expect(screen.getByTestId("cold-scan-gate")).toBeInTheDocument();
    expect(screen.queryByTestId("permalink-read-error")).toBeNull();
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});

describe("the sibling reads under the same outage are not answered as empty", () => {
  it.each(UNREACHABLE)("%s → history null (not the empty history), passport/recs unresolved, skill history says so", async (_label, make) => {
    h.report = { repo: { owner: "acme", name: "web" }, level: { id: "L2", name: "Assisted" }, overallScore: 50, scannedAt: new Date().toISOString() };
    h.prisma = prismaThrowing(make);
    await renderPage();
    expect(captured).not.toBeNull();
    // History: null leaves ReportView's client fetch in charge; the empty-history ANSWER would not.
    expect(captured!.serverHistory).toBeNull();
    expect(captured!.serverPassport).toBeUndefined();
    expect(captured!.serverRecs).toBeUndefined();
    expect(screen.getByTestId("skill-history-unavailable")).toBeInTheDocument();
    expect(reportedMessages()).toEqual(
      expect.arrayContaining([
        "report permalink: getRepositoryHistory failed",
        "report permalink: getRepoPassport failed",
        "report permalink: getLatestRecommendations failed",
        "report permalink: getSkillHistory failed",
      ]),
    );
  });
});
