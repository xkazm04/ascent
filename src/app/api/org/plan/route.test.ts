// Route test for POST /api/org/plan (Wave 7 a11y/bug fixes — SEC #1 actor attribution).
// Pins the one invariant this fix introduces: an owner-driven plan change records the actor in the
// dedicated `actorId` audit column (so the AuditLogViewer's Actor column + the actor filter can see
// it), NOT only inside `meta.actor` where the viewer never reads it.
//
// Route harness mirrors the playbooks route test: NextResponse is faked as a Response subclass;
// db + authz + auth are fully mocked. `@/lib/plans` is the real pure validator.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const {
  mockIsDbConfigured,
  mockGetOrgId,
  mockRecordAudit,
  mockSetOrgPlan,
  mockRequireOrgRole,
  mockGetSession,
  mockIsSameOrigin,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockSetOrgPlan: vi.fn(),
  mockRequireOrgRole: vi.fn(),
  mockGetSession: vi.fn(),
  mockIsSameOrigin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getOrgId: mockGetOrgId,
  recordAudit: mockRecordAudit,
  setOrgPlan: mockSetOrgPlan,
}));

vi.mock("@/lib/authz", () => ({
  requireOrgRole: mockRequireOrgRole,
}));

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
  isSameOrigin: mockIsSameOrigin,
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://t/api/org/plan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockIsSameOrigin.mockReturnValue(true);
  mockRequireOrgRole.mockResolvedValue(null); // owner access granted
  mockSetOrgPlan.mockResolvedValue(true);
  mockGetOrgId.mockResolvedValue("org_acme");
  mockRecordAudit.mockResolvedValue(true);
  mockGetSession.mockResolvedValue({ login: "alice" });
});

describe("POST /api/org/plan — actor attribution (SEC #1)", () => {
  it("records the actor in the dedicated actorId column, not meta.actor", async () => {
    const res = await POST(req({ org: "acme", plan: "free" }));
    expect(res.status).toBe(200);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const [action, meta, opts] = mockRecordAudit.mock.calls[0];
    expect(action).toBe("org.plan");
    // The actor must be in the filterable/visible column...
    expect(opts.actorId).toBe("alice");
    // ...and NOT shoved into meta where the viewer never reads it.
    expect(meta.actor).toBeUndefined();
  });

  it("still records (actorId undefined) when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(req({ org: "acme", plan: "free" }));
    expect(res.status).toBe(200);
    const [, , opts] = mockRecordAudit.mock.calls[0];
    expect(opts.actorId).toBeUndefined();
  });
});
