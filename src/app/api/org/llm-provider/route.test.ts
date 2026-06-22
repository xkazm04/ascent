// Route test for /api/org/llm-provider (BYOM, Feature 1). Pins the privileged-config authorization
// chain + the secret-safety contract:
//   GET: owner-gated; returns secret-free metadata + planAllowed + encryptionConfigured.
//   POST: same-origin -> owner -> Enterprise plan (403) -> encryption configured (409) -> save + audit.
//   DELETE: owner-gated; disables + clears + audits.
// next/server is faked; db/authz/auth/crypto are mocked; plans.ts runs REAL (driven by the mocked plan).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(),
  getOrgLlmConfig: vi.fn(),
  setOrgLlmConfig: vi.fn(),
  disableOrgLlmConfig: vi.fn(),
  getCreditState: vi.fn(),
  getOrgId: vi.fn(),
  recordAudit: vi.fn(),
  requireOrgRole: vi.fn(),
  getSession: vi.fn(),
  isSameOrigin: vi.fn(),
  isEncryptionConfigured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  getOrgLlmConfig: h.getOrgLlmConfig,
  setOrgLlmConfig: h.setOrgLlmConfig,
  disableOrgLlmConfig: h.disableOrgLlmConfig,
  getCreditState: h.getCreditState,
  getOrgId: h.getOrgId,
  recordAudit: h.recordAudit,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ getSession: h.getSession, isSameOrigin: h.isSameOrigin }));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: h.isEncryptionConfigured }));

import { GET, POST, DELETE } from "./route";

const post = (body: unknown) => new Request("http://t/api/org/llm-provider", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const del = (body: unknown) => new Request("http://t/api/org/llm-provider", { method: "DELETE", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const valid = { org: "acme", modelId: "us.anthropic.claude-sonnet-4-6", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "SUPERSECRETVALUE", enabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.requireOrgRole.mockResolvedValue(null); // owner granted
  h.getCreditState.mockResolvedValue({ plan: "enterprise", balance: 0, unlimited: true });
  h.isSameOrigin.mockReturnValue(true);
  h.isEncryptionConfigured.mockReturnValue(true);
  h.setOrgLlmConfig.mockResolvedValue({ ok: true });
  h.getOrgLlmConfig.mockResolvedValue(null);
  h.getOrgId.mockResolvedValue("org_acme");
  h.recordAudit.mockResolvedValue(undefined);
  h.getSession.mockResolvedValue({ login: "alice" });
});

describe("GET /api/org/llm-provider", () => {
  it("requires ?org and the owner role", async () => {
    expect((await GET(new Request("http://t/api/org/llm-provider"))).status).toBe(400);
    h.requireOrgRole.mockResolvedValue(Response.json({ error: "owner only" }, { status: 403 }));
    expect((await GET(new Request("http://t/api/org/llm-provider?org=acme"))).status).toBe(403);
  });

  it("returns secret-free metadata + planAllowed + encryptionConfigured", async () => {
    h.getOrgLlmConfig.mockResolvedValue({ provider: "bedrock", enabled: true, modelId: "m", region: "us-east-1", authMode: "static", hasCredentials: true, lastValidatedAt: null, lastValidationError: null, createdBy: null, updatedAt: "x" });
    const res = await GET(new Request("http://t/api/org/llm-provider?org=acme"));
    const body = await res.json();
    expect(body.planAllowed).toBe(true);
    expect(body.encryptionConfigured).toBe(true);
    expect(body.config.hasCredentials).toBe(true);
    expect(JSON.stringify(body)).not.toContain("credentialsEncrypted");
  });
});

describe("POST /api/org/llm-provider — gate chain + order", () => {
  it("503 db off", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await POST(post(valid))).status).toBe(503);
  });
  it("403 cross-origin (before any write)", async () => {
    h.isSameOrigin.mockReturnValue(false);
    const res = await POST(post(valid));
    expect(res.status).toBe(403);
    expect(h.setOrgLlmConfig).not.toHaveBeenCalled();
  });
  it("400 missing modelId", async () => {
    expect((await POST(post({ org: "acme" }))).status).toBe(400);
  });
  it("denies a non-owner verbatim", async () => {
    h.requireOrgRole.mockResolvedValue(Response.json({ error: "owner only" }, { status: 403 }));
    const res = await POST(post(valid));
    expect(res.status).toBe(403);
    expect(h.setOrgLlmConfig).not.toHaveBeenCalled();
  });
  it("403 on a non-Enterprise plan", async () => {
    h.getCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
    const res = await POST(post(valid));
    expect(res.status).toBe(403);
    expect(h.setOrgLlmConfig).not.toHaveBeenCalled();
  });
  it("409 when ENCRYPTION_KEY is unconfigured (fail closed), no write", async () => {
    h.isEncryptionConfigured.mockReturnValue(false);
    const res = await POST(post(valid));
    expect(res.status).toBe(409);
    expect(h.setOrgLlmConfig).not.toHaveBeenCalled();
  });
  it("saves + audits on the happy path", async () => {
    const res = await POST(post(valid));
    expect(res.status).toBe(200);
    expect(h.setOrgLlmConfig).toHaveBeenCalledTimes(1);
    expect(h.recordAudit.mock.calls[0][0]).toBe("org.llm_provider.updated");
    // the audit meta must not carry the secret OR the access key
    expect(JSON.stringify(h.recordAudit.mock.calls[0][1])).not.toContain("AKIAEXAMPLE");
    expect(JSON.stringify(h.recordAudit.mock.calls[0][1])).not.toContain("SUPERSECRETVALUE");
  });
  it("propagates a setOrgLlmConfig validation error as 400", async () => {
    h.setOrgLlmConfig.mockResolvedValue({ ok: false, error: "bad" });
    expect((await POST(post(valid))).status).toBe(400);
  });
});

describe("DELETE /api/org/llm-provider", () => {
  it("owner-gated; disables + clears + audits", async () => {
    const res = await DELETE(del({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(h.disableOrgLlmConfig).toHaveBeenCalledWith("acme");
    expect(h.recordAudit.mock.calls[0][0]).toBe("org.llm_provider.disabled");
  });
  it("denies a non-owner", async () => {
    h.requireOrgRole.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await DELETE(del({ org: "acme" }));
    expect(res.status).toBe(403);
    expect(h.disableOrgLlmConfig).not.toHaveBeenCalled();
  });
});
