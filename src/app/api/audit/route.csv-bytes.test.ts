// Byte-level pin of the CSV export across a multi-page walk. The cursor loop moved out of route.ts into
// src/lib/db/audit-walk.ts (walkAuditLog) so the integrity sweep walks the same rows; this pins that the
// move changed nothing a filed export carries: body bytes, SHA header, row count, truncation headers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true), getAuditLog: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));

import { GET } from "./route";
import { getAuditLog } from "@/lib/db";

const mockGetAuditLog = vi.mocked(getAuditLog);

const row = (i: number, integrity: string) => ({
  id: `a${i}`,
  action: i === 2 ? "=SUM(1)" : "scan.completed",
  actorId: i === 3 ? null : `user_${i}`,
  orgId: "org_acme",
  at: `2026-10-0${i}T00:00:00.000Z`,
  meta: { scanId: `s${i}`, note: 'a, "b"' },
  scan: i === 1 ? { id: "s1", repo: "acme/web", level: "L2", overall: 87, headSha: "abc" } : null,
  integrity,
});

const EXPECTED =
  'at,action,actorId,orgId,repo,level,overall,headSha,integrity,meta\n' +
  '"2026-10-01T00:00:00.000Z","scan.completed","user_1","org_acme","acme/web","L2","87","abc","ok","{""scanId"":""s1"",""note"":""a, \\""b\\""""}"\n' +
  '"2026-10-02T00:00:00.000Z","\'=SUM(1)","user_2","org_acme","","","","","tampered","{""scanId"":""s2"",""note"":""a, \\""b\\""""}"\n' +
  '"2026-10-03T00:00:00.000Z","scan.completed","","org_acme","","","","","unsigned","{""scanId"":""s3"",""note"":""a, \\""b\\""""}"\n';

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/audit?format=csv - byte-identical across the walkAuditLog extraction", () => {
  it("walks every page and emits exactly the pinned bytes, SHA and completeness headers", async () => {
    mockGetAuditLog
      .mockResolvedValueOnce({ entries: [row(1, "ok"), row(2, "tampered")], nextCursor: "c1" } as never)
      .mockResolvedValueOnce({ entries: [row(3, "unsigned")], nextCursor: null } as never);

    const res = await GET(new Request("http://localhost/api/audit?org=acme&action=scan.completed&format=csv"));
    const body = await res.text();

    expect(body).toBe(EXPECTED);
    expect(res.headers.get("x-ascent-content-sha256")).toBe(createHash("sha256").update(body).digest("hex"));
    expect(res.headers.get("x-ascent-row-count")).toBe("3");
    expect(res.headers.get("x-ascent-truncated")).toBe("false");
    expect(res.headers.get("x-ascent-row-cap")).toBeNull();
    expect(res.headers.get("content-disposition")).not.toContain("-PARTIAL");
    // Pages of 100, cursor threaded, the filter carried on every page.
    expect(mockGetAuditLog.mock.calls.map((c) => c[1])).toEqual([
      expect.objectContaining({ action: "scan.completed", cursor: null, limit: 100 }),
      expect.objectContaining({ action: "scan.completed", cursor: "c1", limit: 100 }),
    ]);
  });

  it("marks the export PARTIAL when the 10000 cap is reached with a cursor still set", async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(1, i % 2 ? "ok" : "unsigned"));
    mockGetAuditLog.mockResolvedValue({ entries: full, nextCursor: "more" } as never);

    const res = await GET(new Request("http://localhost/api/audit?org=acme&format=csv"));
    await res.text();

    expect(mockGetAuditLog).toHaveBeenCalledTimes(100);
    expect(res.headers.get("x-ascent-row-count")).toBe("10000");
    expect(res.headers.get("x-ascent-truncated")).toBe("true");
    expect(res.headers.get("x-ascent-row-cap")).toBe("10000");
    expect(res.headers.get("content-disposition")).toContain("-PARTIAL.csv");
  });
});
