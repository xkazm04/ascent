// Integration credentials cannot be stored, rotated or deleted on the shared public org (security scan
// 2026-10-07, finding O8). requireOrgRole admits "public" for any signed-in viewer; the ingest-token
// rotation and the OpenAI connection PUT/DELETE refuse it before the gate. Runs the REAL @/lib/authz.

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
  bumpIngestTokenEpoch: vi.fn(async () => 2),
}));
vi.mock("@/lib/db/provider-credentials", () => ({
  deleteProviderConnection: vi.fn(async () => true),
  getProviderConnection: vi.fn(async () => null),
  setProviderConnection: vi.fn(async () => ({})),
}));
vi.mock("@/lib/integrations/ingest-token", () => ({
  isIngestConfigured: () => true,
  ingestToken: vi.fn(() => "tok"),
}));

import { POST as rotate } from "./token/route";
import { PUT, DELETE } from "./openai/route";
import { bumpIngestTokenEpoch } from "@/lib/db";
import { deleteProviderConnection, setProviderConnection } from "@/lib/db/provider-credentials";

const req = (method: string, body: unknown) =>
  new Request("http://localhost/api/integrations/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("/api/integrations/{token,openai} as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await rotate(req("POST", { org: "acme", rotate: true }))).status).toBe(403);
    expect((await PUT(req("PUT", { org: "acme", adminKey: "sk-admin-x" }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { org: "acme" }))).status).toBe(403);
    expect(bumpIngestTokenEpoch).not.toHaveBeenCalled();
    expect(setProviderConnection).not.toHaveBeenCalled();
    expect(deleteProviderConnection).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("token rotation refuses %j", async (org) => {
    const res = await rotate(req("POST", { org, rotate: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(bumpIngestTokenEpoch).not.toHaveBeenCalled();
  });

  it("OpenAI PUT refuses storing a key on public", async () => {
    expect((await PUT(req("PUT", { org: "public", adminKey: "sk-admin-abc" }))).status).toBe(403);
    expect(setProviderConnection).not.toHaveBeenCalled();
  });

  it("OpenAI DELETE refuses removing the connection on public", async () => {
    expect((await DELETE(req("DELETE", { org: "public" }))).status).toBe(403);
    expect(deleteProviderConnection).not.toHaveBeenCalled();
  });
});
