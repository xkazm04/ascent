// Sweep: the share-card route's lookup and render failures are reported, not only logged.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("next/og", () => ({ ImageResponse: class { constructor() { throw new Error("satori exploded"); } } }));
vi.mock("@/lib/og/report-card", () => ({ ReportShareCard: () => null }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn(async () => "acme") }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getScanReportByCommit: vi.fn() }));

import { GET } from "./route";
import { getScanReportByCommit } from "@/lib/db";

const get = () => GET(new Request("http://localhost/api/report/share-card?repo=acme/app"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("share-card failure doors", () => {
  it("reports a failed lookup (503) and a failed render (500)", async () => {
    vi.mocked(getScanReportByCommit).mockRejectedValueOnce(new Error("db down"));
    expect((await get()).status).toBe(503);
    vi.mocked(getScanReportByCommit).mockResolvedValueOnce({ repo: "acme/app" } as never);
    expect((await get()).status).toBe(500);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
