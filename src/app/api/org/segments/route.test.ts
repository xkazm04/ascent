// Gate-tests for POST /api/org/segments (create) — auth + tenant boundary.
// The create route gates on the CLIENT-supplied body.org via requireOrgAccess; a denial Response
// must short-circuit BEFORE createSegment runs, and createSegment is always called with that same
// org so a segment can only be born inside the caller's resolved tenant. P2002 maps to 409.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  createSegment: vi.fn(async () => ({ id: "seg-1" })),
  getRepoSegmentMap: vi.fn(async () => ({})),
  listSegments: vi.fn(async () => []),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRead: vi.fn(async () => null),
}));

import { POST } from "./route";
import { createSegment } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockCreate = vi.mocked(createSegment);
const mockAccess = vi.mocked(requireOrgAccess);

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "seg-1" } as never);
});

describe("POST /api/org/segments — auth gate on create", () => {
  it("DENIES a caller without org access — returns the gate Response and never writes", async () => {
    const denial = Response.json({ error: "You don't have access to this organization." }, { status: 403 });
    mockAccess.mockResolvedValue(denial as never);
    const res = await post({ org: "victim", name: "Platform" });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s a missing name without ever calling the gate or the db", async () => {
    const res = await post({ org: "acme" });
    expect(res.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates inside the SAME org the gate passed for — no tenant smuggling", async () => {
    const res = await post({ org: "acme", name: "Platform", color: "#a1b2c3" });
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // The org createSegment receives is the gated org, not a separate field — the row is born in-tenant.
    expect(mockCreate.mock.calls[0][0]).toBe("acme");
  });

  it("maps a P2002 unique-name clash to 409", async () => {
    mockCreate.mockRejectedValue({ code: "P2002" } as never);
    const res = await post({ org: "acme", name: "Platform" });
    expect(res.status).toBe(409);
  });
});
