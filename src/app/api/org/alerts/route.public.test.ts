// The shared public org's alert rules cannot be written by anyone (security scan 2026-10-07, finding
// O4). requireOrgRole admits "public" for any signed-in viewer; the POST admin branch (webhook,
// thresholds, test-send, resend) refuses it before the gate. The viewer's own "seen" watermark is a
// self-scoped stamp on a row they already hold and is left alone. Runs the REAL @/lib/authz.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The REAL @/lib/authz runs; only its identity and data edges are stubbed. The caller is a signed-in
// account under the login wall with no Membership anywhere, and every org already has an owner (so
// there is no bootstrap claim either): a stranger.
vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  getViewer: vi.fn(async () => ({ id: "u1", login: "stranger" })),
  requireViewer: vi.fn(async () => null),
  resolveViewerLogin: vi.fn(async () => "stranger"),
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: vi.fn(async () => null),
  isAuthConfigured: () => false,
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => false, isOrgAdminViaInstallation: vi.fn() }));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
  isPersonalOrg: vi.fn(async () => false),
  recordOrgAudit: vi.fn(async () => {}),
  getAlertsWatermark: vi.fn(async () => null),
  getOrgAlertThresholds: vi.fn(async () => ({})),
  getOrgAlertWebhook: vi.fn(async () => null),
  getOrgMovementSince: vi.fn(async () => null),
  listAlertEvents: vi.fn(async () => []),
  markAlertsSeen: vi.fn(async () => false),
  setOrgAlertThresholds: vi.fn(async () => {}),
  setOrgAlertWebhook: vi.fn(async () => {}),
}));
vi.mock("@/lib/alert-door", () => ({ deliverAlert: vi.fn(async () => ({ delivered: true, outcome: "ok" })) }));
vi.mock("@/lib/db/alert-events", () => ({ getAlertEventForResend: vi.fn(async () => null) }));

import { POST } from "./route";
import { deliverAlert } from "@/lib/alert-door";
import { markAlertsSeen, setOrgAlertThresholds, setOrgAlertWebhook } from "@/lib/db";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/alerts as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    expect((await POST(req({ org: "acme", overallDrop: 5 }))).status).toBe(403);
    expect(setOrgAlertThresholds).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses rule writes, test-sends and resends on %j", async (org) => {
    for (const body of [
      { org, overallDrop: 5, dimensionDrop: 5 },
      { org, webhookUrl: "https://hooks.example.test/x" },
      { org, test: true },
      { org, resend: "evt_1" },
    ]) {
      const res = await POST(req(body));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    }
    expect(setOrgAlertThresholds).not.toHaveBeenCalled();
    expect(setOrgAlertWebhook).not.toHaveBeenCalled();
    expect(deliverAlert).not.toHaveBeenCalled();
  });

  it("leaves the viewer's own seen watermark working on public", async () => {
    const res = await POST(req({ org: "public", seen: true }));
    expect(res.status).toBe(200);
    expect(markAlertsSeen).toHaveBeenCalled();
  });
});
