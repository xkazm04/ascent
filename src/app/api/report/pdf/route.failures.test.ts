// Sweep: a FAILED plan read is not "not on Pro" (503 try-again, reported, never the paywall 403), and
// the lookup / render failure doors are reported, not only logged.

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
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn(async () => "acme"), PUBLIC_ORG: "public" }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), canReadOrg: vi.fn(async () => false) }));
vi.mock("@/lib/db", () => ({ getScanReportByCommit: vi.fn(), isDbConfigured: () => true, getCreditState: vi.fn() }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }));
vi.mock("@/lib/pdf/report-document", () => ({ ReportDocument: () => null }));

import { GET } from "./route";
import { getCreditState, getScanReportByCommit } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";

const boom = new Error("db down");
const get = () => GET(new Request("http://localhost/api/report/pdf?repo=acme/app"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCreditState).mockResolvedValue({ plan: "team" } as never);
  vi.mocked(getScanReportByCommit).mockResolvedValue({ repo: "acme/app" } as never);
});

describe("report PDF failure doors", () => {
  it("answers 503 (not the Pro-plan 403) when the plan read fails, and reports it", async () => {
    vi.mocked(getCreditState).mockRejectedValue(boom);
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error).not.toMatch(/Pro-plan/);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ status: 503 }));
    expect(getScanReportByCommit).not.toHaveBeenCalled();
  });

  it("still answers 403 when the plan read RETURNED a free plan", async () => {
    vi.mocked(getCreditState).mockResolvedValue({ plan: "free" } as never);
    expect((await get()).status).toBe(403);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed report lookup and a failed render", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValueOnce(boom);
    expect((await get()).status).toBe(503);
    vi.mocked(renderToBuffer).mockRejectedValueOnce(boom);
    expect((await get()).status).toBe(500);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining("report/pdf") }));
  });
});

// export-0 (challenge-2026-10-22d): a configured-but-unreachable DB is a 503 try-again, never the 404
// "Scan it first". The read is STRICT (the default reader resolves an outage to null -> 404).
describe("report PDF export: strict read", () => {
  it("reads strict and maps a DbUnavailableError to 503", async () => {
    const { DbUnavailableError } = await import("@/lib/db/client");
    vi.mocked(getScanReportByCommit).mockRejectedValueOnce(new DbUnavailableError(new Error("ECONNREFUSED")));
    const res = await get();
    expect(getScanReportByCommit).toHaveBeenCalledWith("acme", "app", expect.objectContaining({ strict: true }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/^Couldn't load this report right now/);
  });
});
