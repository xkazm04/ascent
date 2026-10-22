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
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), canReadOrg: vi.fn(async () => false) }));
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

// export-0 (challenge-2026-10-22d): a configured-but-unreachable DB is a 503 try-again, never the 404
// "Scan it first". The read is STRICT (the default reader resolves an outage to null -> 404).
describe("share-card export: strict read", () => {
  it("reads strict and maps a DbUnavailableError to 503", async () => {
    const { DbUnavailableError } = await import("@/lib/db/client");
    vi.mocked(getScanReportByCommit).mockRejectedValueOnce(new DbUnavailableError(new Error("ECONNREFUSED")));
    const res = await get();
    expect(getScanReportByCommit).toHaveBeenCalledWith("acme", "app", expect.objectContaining({ strict: true }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/^Couldn't load this report right now/);
  });
});
