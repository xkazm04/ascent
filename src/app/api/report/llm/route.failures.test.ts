// Sweep: the report-lookup failure on the LLM markdown export is reported, not only logged.

import { describe, it, expect, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn(async () => "acme") }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));
const boom = new Error("db down");
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getScanReportByCommit: vi.fn(async () => { throw boom; }) }));

import { GET } from "./route";

describe("report LLM export failure door", () => {
  it("answers 503 and reports a failed lookup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new Request("http://localhost/api/report/llm?repo=acme/app"));
    expect(res.status).toBe(503);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining("report/llm") }));
  });
});
