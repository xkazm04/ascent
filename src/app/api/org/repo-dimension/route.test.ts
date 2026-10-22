// A FAILED scan read is not "no stored scan": 503 try-again (reported), never the 404 'No stored scan'
// that tells a user to re-scan a repo that already has one. A failed history read only costs the
// sparkline: the response still answers, and the degrade is logged and reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({
  reportHandledError: report,
  respondError: (status: number, message: string, opts: { cause?: unknown } = {}) => {
    if (opts.cause !== undefined) report(opts.cause, { status, message });
    return new Response(JSON.stringify({ error: message }), { status });
  },
}));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/authz", () => ({ canReadOrg: vi.fn(async () => true), requireOrgAccess: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "ana") }));
vi.mock("@/lib/db", () => ({ getScanReportByCommit: vi.fn(), getRepositoryHistory: vi.fn(), getLatestRecommendations: vi.fn() }));

import { GET } from "./route";
import { getLatestRecommendations, getRepositoryHistory, getScanReportByCommit } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const boom = new Error("db down");
const get = () => GET(new Request("http://localhost/api/org/repo-dimension?org=acme&repo=acme/app&dim=D1"));
const REPORT = {
  scannedAt: "2026-10-01T00:00:00Z", overallScore: 50, level: { id: "L2", name: "x" },
  dimensions: [{ id: "D1" }], roadmap: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getScanReportByCommit).mockResolvedValue(REPORT as never);
  vi.mocked(getRepositoryHistory).mockResolvedValue({ scans: [] } as never);
  vi.mocked(getLatestRecommendations).mockResolvedValue(null as never);
  vi.mocked(requireOrgAccess).mockResolvedValue(null);
});

describe("GET /api/org/repo-dimension failed reads", () => {
  it("answers 503 (not 404 'No stored scan') when the scan read FAILS, and reports it", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValue(boom);
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toMatch(/No stored scan/);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ status: 503 }));
  });

  it("still answers 404 'No stored scan' when the read RETURNED none", async () => {
    vi.mocked(getScanReportByCommit).mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No stored scan/);
    expect(report).not.toHaveBeenCalled();
  });

  it("answers 200 without a series, warns and reports, when only the history read fails", async () => {
    vi.mocked(getRepositoryHistory).mockRejectedValue(boom);
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).series).toEqual([]);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("repo-dimension history failed");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
  });
});

// The drill-in's next steps carry tracked status, so a dismissed or done gap is never shown as open,
// and the viewer's write access decides whether any verdict is offered.
describe("GET /api/org/repo-dimension tracked steps", () => {
  const getD3 = () => GET(new Request("http://localhost/api/org/repo-dimension?org=acme&repo=acme/app&dim=D3"));
  const rec = (id: string, dimension: string, status: string) => ({
    id, title: id, dimension, impact: "high", effort: "low", rationale: "", explore: [], status,
    assigneeLogin: id === "r1" ? "ana" : null, targetDate: id === "r1" ? "2026-11-01" : null, projectedPoints: 3,
  });
  const D3_REPORT = {
    ...REPORT, dimensions: [{ id: "D3" }],
    roadmap: [{ title: "roadmap-only", dimension: "D3", impact: "high", effort: "low", rationale: "" }],
  };

  beforeEach(() => {
    vi.mocked(getScanReportByCommit).mockResolvedValue(D3_REPORT as never);
    vi.mocked(getLatestRecommendations).mockResolvedValue({
      scanId: "s1",
      items: [rec("r1", "D3", "open"), rec("r2", "D3", "dismissed"), rec("r3", "D3", "done"), rec("r4", "D5", "open")],
    } as never);
  });

  it("returns exactly the dimension's recs as steps, each with id/status/owner/due/points, tracked", async () => {
    const body = await (await getD3()).json();
    expect(body.tracked).toBe(true);
    expect(body.steps.map((s: { id: string }) => s.id)).toEqual(["r1", "r2", "r3"]);
    for (const s of body.steps) {
      for (const k of ["id", "status", "assigneeLogin", "targetDate", "projectedPoints"]) expect(s).toHaveProperty(k);
    }
    expect(body.steps[0]).toMatchObject({ status: "open", assigneeLogin: "ana", targetDate: "2026-11-01", projectedPoints: 3 });
    expect(body.nextSteps).toHaveLength(1);
    expect(vi.mocked(getLatestRecommendations)).toHaveBeenCalledWith("acme", "app", expect.objectContaining({ orgSlug: "acme", strict: true }));
  });

  it("a REJECTED tracking read still answers 200 from the roadmap, flagged and noted", async () => {
    vi.mocked(getLatestRecommendations).mockRejectedValue(boom);
    const res = await getD3();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tracked).toBe(false);
    expect(body.trackingError).toBe(true);
    expect(body.canAct).toBe(false);
    expect(body.steps).toEqual([expect.objectContaining({ title: "roadmap-only", id: null, tracked: false })]);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("repo-dimension recommendations failed");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
  });

  it("a null tracking read (no DB / no row) is untracked without an error flag", async () => {
    vi.mocked(getLatestRecommendations).mockResolvedValue(null as never);
    const body = await (await getD3()).json();
    expect(body.tracked).toBe(false);
    expect(body).not.toHaveProperty("trackingError");
    expect(body.canAct).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it("canAct is true with write access and carries the viewer login", async () => {
    const body = await (await getD3()).json();
    expect(body.canAct).toBe(true);
    expect(body.viewerLogin).toBe("ana");
  });

  it("canAct is false for a read-only viewer (requireOrgAccess denies)", async () => {
    vi.mocked(requireOrgAccess).mockResolvedValue(new Response("{}", { status: 403 }) as never);
    const body = await (await getD3()).json();
    expect(body.canAct).toBe(false);
    expect(body.tracked).toBe(true);
  });

  it("canAct is false on the public org even with tracking on", async () => {
    const res = await GET(new Request("http://localhost/api/org/repo-dimension?org=public&repo=acme/app&dim=D3"));
    expect((await res.json()).canAct).toBe(false);
  });
});
