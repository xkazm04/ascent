// robustness-4: the ledger read keeps "revoked" (a row) apart from "unreadable" (an outage), and every
// failed read reaches a door. Fail-closed is unchanged: both are non-live.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
const getSessionVersion = vi.fn<(key: string) => Promise<number>>(async () => 0);
vi.mock("@/lib/db/sessions", () => ({ getSessionVersion: (k: string) => getSessionVersion(k), bumpSessionVersion: vi.fn() }));
const findMany = vi.fn<(args: unknown) => Promise<{ login: string }[]>>(async () => []);
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({ sessionRevocation: { findMany } }) }));
const getAuditLog = vi.fn<(org: string, q: { action?: string }) => Promise<unknown>>(async () => null);
vi.mock("@/lib/db/scans-audit", () => ({ getAuditLog: (o: string, q: never) => getAuditLog(o, q) }));

import { briefingShareLinkState, isBriefingShareRevoked, listBriefingShareGrants, revokedBriefingShareJtis } from "./org-share";

const boom = new Error("ledger unreachable");

beforeEach(() => {
  vi.clearAllMocks();
  getSessionVersion.mockImplementation(async () => 0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("briefingShareLinkState", () => {
  it("is live when nothing is revoked, and does not report", async () => {
    expect(await briefingShareLinkState("acme", "j")).toBe("live");
    expect(report).not.toHaveBeenCalled();
  });

  it("is revoked for a revocation row (scoped or legacy key)", async () => {
    getSessionVersion.mockImplementation(async (k) => (k === "briefing-share:j" ? 1 : 0));
    expect(await briefingShareLinkState("acme", "j")).toBe("revoked");
    expect(report).not.toHaveBeenCalled();
  });

  it("is UNREADABLE (not revoked) on a ledger outage, warns and reports; the boolean still fails closed", async () => {
    getSessionVersion.mockRejectedValue(boom);
    expect(await briefingShareLinkState("acme", "j")).toBe("unreadable");
    expect(await isBriefingShareRevoked("acme", "j")).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("revocation ledger failed"), "ledger unreachable");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
  });
});

describe("the grant list's doors", () => {
  it("reports a failed batch lookup while still failing closed as a set", async () => {
    findMany.mockRejectedValue(boom);
    expect([...(await revokedBriefingShareJtis("acme", ["a"]))]).toEqual(["a"]);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining("revocation list") }));
  });

  it("warns and reports when the open-count read fails, and still lists the grant", async () => {
    getAuditLog.mockImplementation(async (_o, q) => {
      if (q.action === "briefing.share.opened") throw boom;
      return { entries: [{ at: "2026-10-01T00:00:00Z", actorId: "me", meta: { jti: "j1", expiresAt: Date.now() + 1e6 } }], nextCursor: null };
    });
    const grants = await listBriefingShareGrants("acme");
    expect(grants).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining("open counts") }));
  });
});
