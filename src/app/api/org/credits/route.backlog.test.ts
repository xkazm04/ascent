// credits-1: GET /api/org/credits carries the credit backlog (which watched repos missed a scan for
// credits) ONLY to a viewer who could run the resume scan themselves - the same requireOrgAccess gate
// POST /api/org/scan enforces. A read-only viewer gets the balance and no repo list.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));

const m = vi.hoisted(() => ({
  requireOrgRead: vi.fn(),
  requireOrgAccess: vi.fn(),
  getCreditBacklog: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: m.requireOrgRead, requireOrgAccess: m.requireOrgAccess }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getCreditState: async () => ({ balance: 0, unlimited: false, plan: "free" }),
  getCreditLedger: async () => [],
}));
vi.mock("@/lib/entitlement", () => ({ checkScanEntitlement: async () => ({ allowanceRemaining: 0 }) }));
vi.mock("@/lib/db/credit-backlog", () => ({ getCreditBacklog: m.getCreditBacklog }));

import { GET } from "./route";

const BACKLOG = {
  count: 1,
  repos: [{ repo: "acme/b", skippedAt: "2026-10-04T10:00:00.000Z", via: "cadence" }],
  oldestSkippedAt: "2026-10-04T10:00:00.000Z",
};
const get = (org = "acme") => GET(new Request(`http://localhost/api/org/credits?org=${org}`));

beforeEach(() => {
  vi.clearAllMocks();
  m.requireOrgRead.mockResolvedValue(null);
  m.getCreditBacklog.mockResolvedValue(BACKLOG);
});

describe("GET /api/org/credits creditBacklog", () => {
  it("a reader without org access gets no creditBacklog field and no backlog read", async () => {
    m.requireOrgAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const body = await (await get()).json();
    expect(body.balance).toBe(0);
    expect("creditBacklog" in body).toBe(false);
    expect(m.getCreditBacklog).not.toHaveBeenCalled();
  });

  it("an access-holder gets { count, repos, oldestSkippedAt } with string timestamps", async () => {
    m.requireOrgAccess.mockResolvedValue(null);
    const body = await (await get()).json();
    expect(m.getCreditBacklog).toHaveBeenCalledWith("acme");
    expect(body.creditBacklog).toEqual(BACKLOG);
    expect(typeof body.creditBacklog.repos[0].skippedAt).toBe("string");
    expect(typeof body.creditBacklog.oldestSkippedAt).toBe("string");
  });

  it("a failed backlog read leaves the balance answer intact (the field is additive)", async () => {
    m.requireOrgAccess.mockResolvedValue(null);
    m.getCreditBacklog.mockRejectedValue(new Error("db down"));
    const res = await get();
    expect(res.status).toBe(200);
    expect("creditBacklog" in (await res.json())).toBe(false);
  });
});
