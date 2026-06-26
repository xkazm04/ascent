// Tests for org-aware provider selection (BYOM — Feature 1). The db resolver is mocked so this is a
// pure selection test: an active BYOM config builds a Bedrock provider with the org's creds + byom:true
// (which the scan pipeline uses to skip platform credits + the platform fallback); otherwise it falls
// back to the env-driven platform provider with byom:false. forceMock always wins.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockResolve, mockIsActive } = vi.hoisted(() => ({ mockResolve: vi.fn(), mockIsActive: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomProvider: mockResolve, isByomActive: mockIsActive }));

import { getProviderForOrg } from "@/lib/llm";

beforeEach(() => {
  vi.clearAllMocks();
  // No platform key → the non-BYOM fallback resolves to MockProvider (deterministic for the assertion).
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.LLM_PROVIDER = "auto";
  // Default: BYOM not active. The fail-closed throw only fires when resolve fails AND BYOM is active.
  mockIsActive.mockResolvedValue(false);
});

describe("getProviderForOrg", () => {
  it("builds a Bedrock provider with the org's creds when BYOM is active (byom:true)", async () => {
    mockResolve.mockResolvedValue({ model: "us.anthropic.claude-sonnet-4-6", region: "eu-west-1", credentials: { accessKeyId: "AKIA", secretAccessKey: "s" } });
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(true);
    expect(provider.name).toBe("bedrock");
    expect(provider.model).toBe("us.anthropic.claude-sonnet-4-6");
    expect(mockResolve).toHaveBeenCalledWith("acme");
  });

  it("falls back to the platform provider when no active BYOM (byom:false)", async () => {
    mockResolve.mockResolvedValue(null);
    mockIsActive.mockResolvedValue(false); // BYOM not configured → platform fallback is correct
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(false);
    expect(provider.name).toBe("mock"); // no platform key → mock
  });

  it("fails CLOSED when BYOM is active but its creds can't be resolved (no platform fallback)", async () => {
    // ENCRYPTION_KEY rotated / decrypt failure / tampered blob: resolveByomProvider returns null but the
    // org is still BYOM-active. Routing its private source through the env platform provider would breach
    // the in-boundary privacy contract, so selection must THROW rather than silently degrade.
    mockResolve.mockResolvedValue(null);
    mockIsActive.mockResolvedValue(true);
    await expect(getProviderForOrg("acme")).rejects.toThrow(/BYOM is enabled/i);
  });

  it("never consults BYOM for the public org", async () => {
    const { byom } = await getProviderForOrg("public");
    expect(byom).toBe(false);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("forceMock wins over everything (no BYOM lookup)", async () => {
    const { provider, byom } = await getProviderForOrg("acme", { forceMock: true });
    expect(byom).toBe(false);
    expect(provider.name).toBe("mock");
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
