// A forge installation cannot be bound or unbound on the shared public org (security scan 2026-10-07,
// finding O10). requireOrgRole admits "public" for any signed-in viewer; POST and DELETE refuse it
// before the gate. Runs the REAL @/lib/authz.

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
}));
vi.mock("@/lib/db/forge-installations", () => ({
  deleteForgeInstallation: vi.fn(async () => true),
  listForgeInstallations: vi.fn(async () => []),
  upsertForgeInstallation: vi.fn(async () => ({})),
}));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: () => true }));

import { POST, DELETE } from "./route";
import { deleteForgeInstallation, upsertForgeInstallation } from "@/lib/db/forge-installations";

const req = (method: string, org: string) =>
  new Request("http://localhost/api/org/forge/installation", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org, forge: "gitlab", externalId: "group/sub" }),
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/forge/installation as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    expect((await POST(req("POST", "acme"))).status).toBe(403);
    expect((await DELETE(req("DELETE", "acme"))).status).toBe(403);
    expect(upsertForgeInstallation).not.toHaveBeenCalled();
    expect(deleteForgeInstallation).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses binding an installation on %j", async (org) => {
    const res = await POST(req("POST", org));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(upsertForgeInstallation).not.toHaveBeenCalled();
  });

  it("DELETE refuses unbinding an installation on public", async () => {
    expect((await DELETE(req("DELETE", "public"))).status).toBe(403);
    expect(deleteForgeInstallation).not.toHaveBeenCalled();
  });
});
