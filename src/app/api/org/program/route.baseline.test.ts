// A FAILED baseline read must not be stored as "no origin": the programme baseline is captured once and
// never revisited, so a transient failure would permanently misstate its starting point. 503 + reported.

import { describe, it, expect, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({
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
const boom = new Error("db down");
vi.mock("@/lib/db", () => ({ getOrgHeaderSummary: vi.fn(async () => { throw boom; }) }));
const startProgram = vi.fn(async () => ({}));
vi.mock("@/lib/db/org-program", () => ({
  endProgram: vi.fn(), getOrgProgram: vi.fn(async () => null), getOrgProgramStatus: vi.fn(),
  isLevelId: () => true, isProgramCadence: () => true, isProgramStatus: () => true,
  setProgramStatus: vi.fn(), startProgram: () => startProgram(),
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRead: vi.fn(async () => null) }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null, invalidTargetDate: () => null }));

import { POST } from "./route";

describe("POST /api/org/program baseline read", () => {
  it("answers 503 and starts nothing when the fleet standing cannot be read", async () => {
    const res = await POST(new Request("http://localhost/api/org/program", { method: "POST", body: JSON.stringify({ org: "acme", name: "Go L4" }) }));
    expect(res.status).toBe(503);
    expect(startProgram).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ status: 503 }));
  });
});
