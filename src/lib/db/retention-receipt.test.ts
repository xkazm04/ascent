// Pins the retention receipt read: it reads this org's own retention rows and nothing else.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getOrgId: vi.fn(),
  isDbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: h.isDbConfigured,
  getPrisma: () => ({ auditLog: { findFirst: h.findFirst } }),
}));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: h.getOrgId }));

import { getRetentionReceipt } from "./retention-receipt";

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.getOrgId.mockResolvedValue("org-acme");
  h.findFirst.mockImplementation(async ({ where }: { where: { action: string } }) =>
    where.action === "retention.purged"
      ? { at: new Date("2026-10-21T02:00:00.000Z"), meta: JSON.stringify({ scansDeleted: 12 }) }
      : { at: new Date("2026-10-03T08:00:00.000Z"), meta: "{}" },
  );
});

describe("getRetentionReceipt", () => {
  it("queries AuditLog only with this org's id and the two retention actions", async () => {
    const r = await getRetentionReceipt("acme");
    expect(h.getOrgId).toHaveBeenCalledWith("acme");
    expect(h.findFirst).toHaveBeenCalled();
    for (const [arg] of h.findFirst.mock.calls as unknown as [{ where: Record<string, unknown> }][]) {
      expect(arg.where.orgId).toBe("org-acme");
      expect(["retention.purged", "retention.updated"]).toContain(arg.where.action);
      expect(Object.keys(arg.where).sort()).toEqual(["action", "orgId"]);
    }
    const actions = (h.findFirst.mock.calls as unknown as [{ where: { action: string } }][]).map(([a]) => a.where.action);
    expect(actions.sort()).toEqual(["retention.purged", "retention.updated"]);
    expect(r).toEqual({
      lastPurge: { at: "2026-10-21T02:00:00.000Z", meta: { scansDeleted: 12 } },
      lastSave: { at: "2026-10-03T08:00:00.000Z", meta: {} },
    });
  });

  it("reads nothing when the org is unknown, so it can never fall back to another org's rows", async () => {
    h.getOrgId.mockResolvedValue(null);
    expect(await getRetentionReceipt("ghost")).toBeNull();
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("treats an unparseable meta as empty rather than throwing", async () => {
    h.findFirst.mockResolvedValue({ at: new Date("2026-10-21T02:00:00.000Z"), meta: "{not json" });
    const r = await getRetentionReceipt("acme");
    expect(r?.lastPurge?.meta).toEqual({});
  });
});
