// GET /api/audit/integrity: the read-only whole-trail verdict sweep. Pins the same gate order as
// /api/audit (503 before 400 before requireOrgRead, and a denial returns verbatim with NO walk), that
// the sweep receives exactly the filter object the CSV branch builds, and that the result is no-store.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));
vi.mock("@/lib/db/audit-walk", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/audit-walk")>()),
  sweepAuditIntegrity: vi.fn(),
}));

import { GET } from "./route";
import { isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { sweepAuditIntegrity } from "@/lib/db/audit-walk";

const mockDb = vi.mocked(isDbConfigured);
const mockGate = vi.mocked(requireOrgRead);
const mockSweep = vi.mocked(sweepAuditIntegrity);

const SUMMARY = { scanned: 3, ok: 2, unsigned: 1, tampered: 0, noSecret: 0, truncated: false, tamperedEntries: [] };
const get = (qs: string) => GET(new Request(`http://localhost/api/audit/integrity${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockReturnValue(true);
  mockGate.mockResolvedValue(null);
  mockSweep.mockResolvedValue(SUMMARY);
});

describe("GET /api/audit/integrity - gate", () => {
  it("returns requireOrgRead's denial verbatim and never walks the trail", async () => {
    mockGate.mockResolvedValue(new Response("{}", { status: 403 }));
    const res = await get("?org=x");
    expect(res.status).toBe(403);
    expect(mockGate).toHaveBeenCalledWith("x");
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("400s on a missing org before gating or walking", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("503s when the DB is off before gating or walking", async () => {
    mockDb.mockReturnValue(false);
    const res = await get("?org=x");
    expect(res.status).toBe(503);
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockSweep).not.toHaveBeenCalled();
  });
});

describe("GET /api/audit/integrity - sweep", () => {
  it("passes exactly the applied filters (the CSV branch's object) and is no-store", async () => {
    const res = await get("?org=x&action=scan.created&since=2026-10-01&cursor=ignored&limit=5");
    expect(res.status).toBe(200);
    expect(mockSweep).toHaveBeenCalledTimes(1);
    const [org, filters] = mockSweep.mock.calls[0]!;
    expect(org).toBe("x");
    expect(filters).toEqual({ action: "scan.created", since: "2026-10-01" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ...SUMMARY, cap: 10000 });
  });

  it("500s with a generic message when the walk throws", async () => {
    mockSweep.mockRejectedValue(new Error("db down"));
    const res = await get("?org=x");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
  });
});
