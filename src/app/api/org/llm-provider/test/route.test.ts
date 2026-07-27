// Route test for /api/org/llm-provider/test (BYOM test-connection). This route hands an org's
// DECRYPTED secret to a provider SDK, so the gate chain is the whole point:
//   same-origin -> org -> owner -> Enterprise plan (403) -> encryption configured (409) -> test.
// It also has to route to the RIGHT provider: a test fired from the OpenRouter card must never be
// validated against Bedrock (and a stored OpenRouter key must never be read as AWS credentials).
// next/server is faked; db/authz/auth/crypto/providers are mocked; plans.ts runs REAL.

import { describe, it, expect, beforeEach, vi } from "vitest";

// The route distinguishes a gate REJECTION from a test RESULT with `x instanceof NextResponse`, so
// the fake must return real instances of itself (and the mocked gates must produce them too) —
// otherwise a denial would fall through into the provider call the gate exists to prevent.
const N = vi.hoisted(() => {
  class FakeNextResponse extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new FakeNextResponse(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return { FakeNextResponse };
});
vi.mock("next/server", () => ({ NextResponse: N.FakeNextResponse }));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(),
  getOrgLlmConfig: vi.fn(),
  getCreditState: vi.fn(),
  recordOrgLlmValidation: vi.fn(),
  getStoredByomSecret: vi.fn(),
  requireOrgRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  isEncryptionConfigured: vi.fn(),
  testBedrockConnection: vi.fn(),
  testOpenRouterConnection: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  getOrgLlmConfig: h.getOrgLlmConfig,
  getCreditState: h.getCreditState,
  recordOrgLlmValidation: h.recordOrgLlmValidation,
}));
vi.mock("@/lib/db/org-llm", () => ({ getStoredByomSecret: h.getStoredByomSecret }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/crypto/secret-box", () => ({ isEncryptionConfigured: h.isEncryptionConfigured }));
vi.mock("@/lib/llm/bedrock", () => ({ testBedrockConnection: h.testBedrockConnection }));
vi.mock("@/lib/llm/openrouter", () => ({ testOpenRouterConnection: h.testOpenRouterConnection }));

import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://t/api/org/llm-provider/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const BEDROCK_CONFIG = { provider: "bedrock", modelId: "us.anthropic.claude-sonnet-4-6", region: "us-east-1" };
const OPENROUTER_CONFIG = { provider: "openrouter", modelId: "openai/gpt-4o-mini", region: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.requireSameOrigin.mockReturnValue(null); // same-origin
  h.requireOrgRole.mockResolvedValue(null); // owner granted
  h.getCreditState.mockResolvedValue({ plan: "enterprise", balance: 0, unlimited: true });
  h.isEncryptionConfigured.mockReturnValue(true);
  h.getOrgLlmConfig.mockResolvedValue(BEDROCK_CONFIG);
  h.getStoredByomSecret.mockResolvedValue(null);
  h.recordOrgLlmValidation.mockResolvedValue(undefined);
  h.testBedrockConnection.mockResolvedValue({ ok: true });
  h.testOpenRouterConnection.mockResolvedValue({ ok: true });
});

const noProviderCalled = () => {
  expect(h.testBedrockConnection).not.toHaveBeenCalled();
  expect(h.testOpenRouterConnection).not.toHaveBeenCalled();
};

describe("POST /api/org/llm-provider/test — gate chain", () => {
  it("503 when the database is off", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await POST(post({ org: "acme" }))).status).toBe(503);
    noProviderCalled();
  });

  it("rejects cross-origin before touching a credential", async () => {
    h.requireSameOrigin.mockReturnValue(N.FakeNextResponse.json({ error: "cross-origin" }, { status: 403 }));
    expect((await POST(post({ org: "acme" }))).status).toBe(403);
    expect(h.getStoredByomSecret).not.toHaveBeenCalled();
    noProviderCalled();
  });

  it("400 without an org", async () => {
    expect((await POST(post({}))).status).toBe(400);
    noProviderCalled();
  });

  it("denies a non-owner verbatim", async () => {
    h.requireOrgRole.mockResolvedValue(N.FakeNextResponse.json({ error: "owner only" }, { status: 403 }));
    expect((await POST(post({ org: "acme" }))).status).toBe(403);
    expect(h.getStoredByomSecret).not.toHaveBeenCalled();
    noProviderCalled();
  });

  it("403 on a non-Enterprise plan", async () => {
    h.getCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
    expect((await POST(post({ org: "acme" }))).status).toBe(403);
    noProviderCalled();
  });

  it("409 when ENCRYPTION_KEY is unconfigured (fail closed)", async () => {
    h.isEncryptionConfigured.mockReturnValue(false);
    expect((await POST(post({ org: "acme" }))).status).toBe(409);
    noProviderCalled();
  });

  it("400 when no model is known from the body or the stored config", async () => {
    h.getOrgLlmConfig.mockResolvedValue(null);
    expect((await POST(post({ org: "acme" }))).status).toBe(400);
    noProviderCalled();
  });
});

describe("POST /api/org/llm-provider/test — Bedrock", () => {
  it("tests body credentials without reading the stored secret", async () => {
    const res = await POST(
      post({ org: "acme", modelId: "us.anthropic.claude-haiku-4-5", region: "eu-west-1", accessKeyId: "AKIAX", secretAccessKey: "SECRETX" }),
    );
    expect(res.status).toBe(200);
    expect(h.testBedrockConnection).toHaveBeenCalledWith({
      model: "us.anthropic.claude-haiku-4-5",
      region: "eu-west-1",
      credentials: { accessKeyId: "AKIAX", secretAccessKey: "SECRETX" },
    });
    expect(h.getStoredByomSecret).not.toHaveBeenCalled();
  });

  it("falls back to the stored AWS credentials + region (save -> test -> enable)", async () => {
    h.getStoredByomSecret.mockResolvedValue({
      provider: "bedrock",
      modelId: BEDROCK_CONFIG.modelId,
      region: "us-east-1",
      credentials: { accessKeyId: "AKIASTORED", secretAccessKey: "STOREDSECRET" },
    });
    const res = await POST(post({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(h.testBedrockConnection).toHaveBeenCalledWith({
      model: BEDROCK_CONFIG.modelId,
      region: "us-east-1",
      credentials: { accessKeyId: "AKIASTORED", secretAccessKey: "STOREDSECRET" },
    });
  });

  it("400s on a half-supplied key pair", async () => {
    expect((await POST(post({ org: "acme", accessKeyId: "AKIAX" }))).status).toBe(400);
    noProviderCalled();
  });

  it("400s when nothing is stored to test", async () => {
    const res = await POST(post({ org: "acme" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/AWS keys/);
    noProviderCalled();
  });

  it("never reads a stored OpenRouter key as AWS credentials", async () => {
    h.getStoredByomSecret.mockResolvedValue({ provider: "openrouter", modelId: "openai/gpt-4o-mini", apiKey: "sk-or-1" });
    expect((await POST(post({ org: "acme" }))).status).toBe(400);
    noProviderCalled();
  });
});

describe("POST /api/org/llm-provider/test — OpenRouter", () => {
  it("tests a body API key against the OpenRouter provider, not Bedrock", async () => {
    const res = await POST(post({ org: "acme", provider: "openrouter", modelId: "anthropic/claude-sonnet-4-6", apiKey: "sk-or-typed" }));
    expect(res.status).toBe(200);
    expect(h.testOpenRouterConnection).toHaveBeenCalledWith({ model: "anthropic/claude-sonnet-4-6", apiKey: "sk-or-typed" });
    expect(h.testBedrockConnection).not.toHaveBeenCalled();
  });

  it("infers the provider from the stored config and falls back to the stored key", async () => {
    h.getOrgLlmConfig.mockResolvedValue(OPENROUTER_CONFIG);
    h.getStoredByomSecret.mockResolvedValue({ provider: "openrouter", modelId: OPENROUTER_CONFIG.modelId, apiKey: "sk-or-stored" });
    const res = await POST(post({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(h.testOpenRouterConnection).toHaveBeenCalledWith({ model: "openai/gpt-4o-mini", apiKey: "sk-or-stored" });
  });

  it("400s when there is no key to test", async () => {
    h.getOrgLlmConfig.mockResolvedValue(OPENROUTER_CONFIG);
    const res = await POST(post({ org: "acme" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/OpenRouter key/);
    noProviderCalled();
  });
});

describe("POST /api/org/llm-provider/test — result handling", () => {
  it("stamps a successful validation and returns 200", async () => {
    h.getStoredByomSecret.mockResolvedValue({
      provider: "bedrock",
      modelId: BEDROCK_CONFIG.modelId,
      region: "us-east-1",
      credentials: { accessKeyId: "A", secretAccessKey: "S" },
    });
    const res = await POST(post({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(h.recordOrgLlmValidation).toHaveBeenCalledWith("acme", true, undefined);
  });

  it("returns 502 + stamps the sanitized error on a failed test, echoing no secret", async () => {
    h.testOpenRouterConnection.mockResolvedValue({ ok: false, error: "OpenRouter request failed (401)" });
    const res = await POST(post({ org: "acme", provider: "openrouter", modelId: "openai/gpt-4o-mini", apiKey: "sk-or-bad" }));
    expect(res.status).toBe(502);
    expect(h.recordOrgLlmValidation).toHaveBeenCalledWith("acme", false, "OpenRouter request failed (401)");
    expect(await res.text()).not.toContain("sk-or-bad");
  });
});
