// Sweep doors on the revoke route: the audit-only grant lookup and org-id reads degrade (the revoke
// itself must still land) but each degrade is logged by name and reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/api/orgPost", () => ({ requireOrgOwnerPost: vi.fn(async () => ({ org: "acme", body: { jti: "g1" } })) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, getViewer: vi.fn(async () => ({ login: "o" })) }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: () => true }));
const revoke = vi.fn(async () => {});
vi.mock("@/lib/db/org-share", () => ({
  revokeBriefingShareLink: () => revoke(),
  listBriefingShareGrants: vi.fn(async () => {
    throw new Error("db down");
  }),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgId: vi.fn(async () => {
    throw new Error("db down");
  }),
  recordAudit: vi.fn(async () => true),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("revoke route degrades reach a door", () => {
  it("still revokes, and names both failed best-effort reads", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledTimes(1);
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("briefing revoke grant lookup failed");
    expect(warned).toContain("briefing revoke audit org id failed");
    expect(report).toHaveBeenCalledTimes(2);
  });
});
