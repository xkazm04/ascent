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
vi.mock("@/lib/authz", () => ({ canReadOrg: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({ getScanReportByCommit: vi.fn(), getRepositoryHistory: vi.fn() }));

import { GET } from "./route";
import { getRepositoryHistory, getScanReportByCommit } from "@/lib/db";

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
