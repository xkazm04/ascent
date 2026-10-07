// The shared public org's BYOM provider cannot be set, disabled or probed by anyone (security scan
// 2026-10-07, finding S3). requireOrgRole("public", "owner") admits any signed-in viewer, so before
// the fix a stranger could store a provider config (credentials included) on the public org, disable
// one, or run a connection probe that stamps its validation columns. The plan is stubbed to one that
// allows BYOM, which is every plan on a self-hosted deployment.

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
  getOrgLlmConfig: vi.fn(async () => ({ provider: "bedrock" })),
  setOrgLlmConfig: vi.fn(async () => ({ ok: true })),
  disableOrgLlmConfig: vi.fn(async () => {}),
  getCreditState: vi.fn(async () => ({ plan: "enterprise", balance: 0, unlimited: true })),
  recordOrgAudit: vi.fn(async () => {}),
  recordOrgLlmValidation: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/org-llm", () => ({ getStoredByomSecret: vi.fn(async () => null) }));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: () => true }));
vi.mock("@/lib/llm/bedrock", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/bedrock")>()),
  testBedrockConnection: vi.fn(async () => ({ ok: true })),
}));

import { POST, DELETE } from "./route";
import { POST as PROBE } from "./test/route";
import { disableOrgLlmConfig, recordOrgLlmValidation, setOrgLlmConfig } from "@/lib/db";

const call = (method: string, body: unknown) =>
  new Request("http://localhost/api/org/llm-provider", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const config = { modelId: "us.anthropic.claude-sonnet-4-6", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "SECRETVALUE", enabled: true };

beforeEach(() => vi.clearAllMocks());

describe("/api/org/llm-provider as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the owner gate", async () => {
    expect((await POST(call("POST", { org: "acme", ...config }))).status).toBe(403);
    expect((await DELETE(call("DELETE", { org: "acme" }))).status).toBe(403);
    expect(setOrgLlmConfig).not.toHaveBeenCalled();
    expect(disableOrgLlmConfig).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses %j with 403 and stores nothing", async (org) => {
    const res = await POST(call("POST", { org, ...config }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(setOrgLlmConfig).not.toHaveBeenCalled();
  });

  it("DELETE refuses the public org with 403 and disables nothing", async () => {
    expect((await DELETE(call("DELETE", { org: "public" }))).status).toBe(403);
    expect(disableOrgLlmConfig).not.toHaveBeenCalled();
  });

  it("the connection probe refuses the public org and stamps nothing", async () => {
    expect((await PROBE(call("POST", { org: "public", ...config }))).status).toBe(403);
    expect(recordOrgLlmValidation).not.toHaveBeenCalled();
  });
});
