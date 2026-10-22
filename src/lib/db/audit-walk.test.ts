// walkAuditLog + sweepAuditIntegrity: the one filtered-trail walk the CSV export and the integrity sweep
// share. getAuditLog is mocked at the barrel so each test controls the pages the walk sees.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditLogEntry } from "@/lib/db";

vi.mock("@/lib/db", () => ({ getAuditLog: vi.fn() }));

import { getAuditLog } from "@/lib/db";
import { auditFiltersFromParams, sweepAuditIntegrity, walkAuditLog } from "./audit-walk";

const mockGetAuditLog = vi.mocked(getAuditLog);

const e = (id: string, integrity: AuditLogEntry["integrity"] = "ok"): AuditLogEntry => ({
  id,
  action: "scan.created",
  actorId: "u",
  orgId: "org_1",
  at: "2026-10-01T00:00:00.000Z",
  meta: {},
  scan: null,
  integrity,
});
const rows = (prefix: string, n: number, v: AuditLogEntry["integrity"] = "ok") =>
  Array.from({ length: n }, (_, i) => e(`${prefix}${i}`, v));

function pages(...ps: AuditLogEntry[][]) {
  ps.forEach((entries, i) =>
    mockGetAuditLog.mockResolvedValueOnce({ entries, nextCursor: i < ps.length - 1 ? `c${i + 1}` : null }),
  );
}

beforeEach(() => vi.resetAllMocks());

describe("walkAuditLog", () => {
  it("visits every row newest-first in pages of 100 and is not truncated when the trail ends", async () => {
    pages(rows("a", 100), rows("b", 100), rows("c", 7));
    const seen: string[] = [];
    const res = await walkAuditLog("acme", { action: "scan.created" }, { cap: 10000, visit: (r) => seen.push(r.id) });

    expect(res).toEqual({ scanned: 207, truncated: false });
    expect(seen[0]).toBe("a0");
    expect(seen.at(-1)).toBe("c6");
    expect(mockGetAuditLog.mock.calls.map((c) => [c[0], c[1]?.cursor, c[1]?.limit, c[1]?.action])).toEqual([
      ["acme", null, 100, "scan.created"],
      ["acme", "c1", 100, "scan.created"],
      ["acme", "c2", 100, "scan.created"],
    ]);
  });

  it("stops at the cap with a cursor still set and reports truncated", async () => {
    mockGetAuditLog.mockResolvedValue({ entries: rows("x", 100), nextCursor: "more" });
    const res = await walkAuditLog("acme", {}, { cap: 300, visit: () => {} });
    expect(res).toEqual({ scanned: 300, truncated: true });
    expect(mockGetAuditLog).toHaveBeenCalledTimes(3);
  });

  it("returns an empty, untruncated walk when persistence is off (getAuditLog -> null)", async () => {
    mockGetAuditLog.mockResolvedValue(null);
    expect(await walkAuditLog("acme", {}, { visit: () => {} })).toEqual({ scanned: 0, truncated: false });
  });
});

describe("sweepAuditIntegrity", () => {
  it("counts each verdict and returns the one tampered row on the LAST page", async () => {
    const bad = e("bad", "tampered");
    pages(rows("a", 100), [...rows("b", 98, "unsigned"), e("b98"), bad]);

    const s = await sweepAuditIntegrity("acme", {});

    expect(s).toEqual({
      scanned: 200,
      ok: 101,
      unsigned: 98,
      tampered: 1,
      noSecret: 0,
      truncated: false,
      tamperedEntries: [bad],
    });
  });

  it("caps tamperedEntries at 50 while `tampered` stays the true count", async () => {
    pages(rows("t", 80, "tampered"));
    const s = await sweepAuditIntegrity("acme", {});
    expect(s.tampered).toBe(80);
    expect(s.tamperedEntries).toHaveLength(50);
    expect(s.tamperedEntries[0]!.id).toBe("t0");
  });

  it("counts no-secret rows apart from ok, and carries truncation through", async () => {
    mockGetAuditLog.mockResolvedValue({ entries: rows("n", 100, "no-secret"), nextCursor: "more" });
    const s = await sweepAuditIntegrity("acme", {}, { cap: 200 });
    expect(s).toMatchObject({ scanned: 200, ok: 0, noSecret: 200, tampered: 0, truncated: true });
  });
});

describe("auditFiltersFromParams", () => {
  it("reads exactly the four filter params and nothing else", () => {
    const f = auditFiltersFromParams(new URLSearchParams("org=x&action=scan.created&since=2026-10-01&cursor=c&format=csv"));
    expect(f).toEqual({ action: "scan.created", since: "2026-10-01" });
  });
});
