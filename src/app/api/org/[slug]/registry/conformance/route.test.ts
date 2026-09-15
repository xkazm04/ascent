// Route test for /api/org/[slug]/registry/conformance (#18). What this route alone owns: the gate
// on each verb, the org-id resolution, and the evidence truncation on the wire.
//
// The sweep's own degrade behaviour is pinned in conformance-sweep.test.ts; asserting it again here
// would only re-assert this file's mock.

import { describe, it, expect, beforeEach, vi } from "vitest";

// `new this(...)`, not `new Response(...)`: this route's refusal path is `gate instanceof
// NextResponse`, so a fake whose `json()` returned a bare Response would let every denial through
// while the test still looked green.
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const { mockRead, mockWrite, mockOrgId, mockMaps, mockPairs, mockSweep } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockWrite: vi.fn(),
  mockOrgId: vi.fn(),
  mockMaps: vi.fn(),
  mockPairs: vi.fn(),
  mockSweep: vi.fn(),
}));

vi.mock("@/lib/registry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/api")>();
  return { ...actual, guardRegistryRead: mockRead, guardRegistryWrite: mockWrite };
});
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockOrgId }));
vi.mock("@/lib/db/org-registry-conformance", () => ({
  listConformanceMaps: mockMaps,
  listConformance: mockPairs,
}));
vi.mock("@/lib/registry/conformance-sweep", () => ({ sweepConformance: mockSweep }));

import { NextResponse } from "next/server";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown) =>
  new Request("http://t/api/org/acme/registry/conformance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue(null);
  mockWrite.mockResolvedValue({ token: "tok", capabilities: {} });
  mockOrgId.mockResolvedValue("org-1");
  mockMaps.mockResolvedValue([]);
  mockPairs.mockResolvedValue([]);
  mockSweep.mockResolvedValue({ scanned: 3, withMap: 2, withoutMap: 1, pairs: 40, warnings: [] });
});

describe("GET", () => {
  it("returns the maps and pairs for a member", async () => {
    mockMaps.mockResolvedValue([{ repoFullName: "acme/api", deviations: 7 }]);
    const res = await GET(new Request("http://t"), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).maps).toHaveLength(1);
  });

  it("refuses a non-member with the read guard's own response", async () => {
    mockRead.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await GET(new Request("http://t"), ctx)).status).toBe(403);
    expect(mockPairs).not.toHaveBeenCalled();
  });

  it("truncates evidence on the wire without truncating the stored row", async () => {
    mockPairs.mockResolvedValue([{ subjectSlug: "s", evidence: "x".repeat(2000) }]);
    const body = await (await GET(new Request("http://t"), ctx)).json();
    expect(body.pairs[0].evidence).toHaveLength(400);
  });

  it("passes a null evidence through as null", async () => {
    mockPairs.mockResolvedValue([{ subjectSlug: "s", evidence: null }]);
    const body = await (await GET(new Request("http://t"), ctx)).json();
    expect(body.pairs[0].evidence).toBeNull();
  });

  it("answers empty for an org that does not resolve, rather than 500ing", async () => {
    mockOrgId.mockResolvedValue(null);
    const body = await (await GET(new Request("http://t"), ctx)).json();
    expect(body).toEqual({ maps: [], pairs: [] });
  });
});

describe("POST", () => {
  it("sweeps the fleet and returns the result", async () => {
    const res = await POST(post({}), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scanned: 3, withMap: 2 });
    expect(mockSweep).toHaveBeenCalledWith("acme", "tok", {});
  });

  it("takes the write gate's refusal verbatim — no token is minted for a non-admin", async () => {
    // Built through the mocked NextResponse: the route's refusal path is `instanceof NextResponse`,
    // so a bare Response would sail straight past the gate — exactly the bug worth catching here.
    mockWrite.mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 403 }));
    expect((await POST(post({}), ctx)).status).toBe(403);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("passes a narrowed repository list through, capped and string-filtered", async () => {
    await POST(post({ repositoryIds: ["a", 7, "b", null] }), ctx);
    expect(mockSweep).toHaveBeenCalledWith("acme", "tok", { repositoryIds: ["a", "b"] });
  });

  it("409s an org with nothing to sweep rather than reporting a successful empty pass", async () => {
    mockSweep.mockResolvedValue({ scanned: 0, withMap: 0, withoutMap: 0, pairs: 0, warnings: [] });
    const res = await POST(post({}), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no-op");
  });

  it("maps a whole-sweep failure to a typed 502, never a bare 500", async () => {
    mockSweep.mockRejectedValue(new Error("token expired"));
    const res = await POST(post({}), ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-error", error: "token expired" });
  });
});
