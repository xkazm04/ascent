// /api/audit authorization wiring — pins that the requireOrgRead gate runs BEFORE any audit read on
// BOTH the JSON and CSV branches. The critical invariant: when requireOrgRead returns a denial
// Response (401/403), the handler returns EXACTLY that Response and getAuditLog is NEVER called — so a
// signed-out / non-member caller can't read (or bulk-export) another tenant's audit trail (IDOR).
// Also pins the pre-gate short-circuits: 503 when the DB is off, 400 when `org` is missing.
// The authz + db boundaries are mocked so we can assert exactly when (and whether) the data read fires.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(), getAuditLog: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured, getAuditLog } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetAuditLog = vi.mocked(getAuditLog);
const mockRequireOrgRead = vi.mocked(requireOrgRead);

const get = (qs: string) => GET(new Request(`http://localhost/api/audit${qs}`));
const deny = (status: number) =>
  new Response(JSON.stringify({ error: "denied" }), { status });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  // Default: authorized. Individual tests override to a denial Response.
  mockRequireOrgRead.mockResolvedValue(null);
  mockGetAuditLog.mockResolvedValue({ entries: [], nextCursor: null });
});

describe("GET /api/audit — authorization gate (cross-tenant IDOR guard)", () => {
  it("denies an unauthorized JSON read with the gate's verbatim Response and never reads the audit log", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(403));

    const res = await get("?org=acme");

    expect(res.status).toBe(403);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    // The data read MUST be short-circuited by the gate.
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("denies an unauthorized CSV bulk export too — the gate runs before exportCsv reads any page", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));

    const res = await get("?org=acme&format=csv");

    expect(res.status).toBe(401);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    // No page is ever fetched for the CSV stream — the export can't leak a denied org's trail.
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("returns the gate's denial status unchanged (gate verdict is not rewritten)", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));
    expect((await get("?org=acme")).status).toBe(401);

    mockRequireOrgRead.mockResolvedValue(deny(403));
    expect((await get("?org=acme")).status).toBe(403);
  });
});

describe("GET /api/audit — authorized read", () => {
  it("serves the audit rows for an org the caller may read", async () => {
    const page = {
      entries: [
        { id: "a1", action: "scan.run", actorId: "actor_1", at: "2026-01-02T00:00:00.000Z", meta: {}, scan: null },
      ],
      nextCursor: null,
    };
    mockGetAuditLog.mockResolvedValue(page);

    const res = await get("?org=acme");

    expect(res.status ?? 200).toBeLessThan(400);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    // The gate ran (returned null = allowed) and THEN the org-scoped read fired for that same org.
    expect(mockGetAuditLog).toHaveBeenCalledTimes(1);
    expect(mockGetAuditLog.mock.calls[0][0]).toBe("acme");
    const body = await res.json();
    expect(body).toEqual(page);
  });

  it("passes the query filters (action/actorId/since/until/cursor/limit) through to getAuditLog", async () => {
    await get("?org=acme&action=scan.run&actorId=actor_9&since=2026-01-01&until=2026-02-01&cursor=cur&limit=50");

    const [slug, query] = mockGetAuditLog.mock.calls[0];
    expect(slug).toBe("acme");
    expect(query).toMatchObject({
      action: "scan.run",
      actorId: "actor_9",
      since: "2026-01-01",
      until: "2026-02-01",
      cursor: "cur",
      limit: 50,
    });
  });
});

describe("GET /api/audit — pre-gate short-circuits", () => {
  it("returns 503 (and neither gates nor reads) when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const res = await get("?org=acme");

    expect(res.status).toBe(503);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("returns 400 (and neither gates nor reads) when `org` is missing", async () => {
    const res = await get("");

    expect(res.status).toBe(400);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });
});
