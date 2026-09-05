// Tests for org-aware provider selection (BYOM — Feature 1). The db resolver is mocked so this is a
// pure selection test: an active BYOM config builds the org's own provider with its creds + byom:true
// (which the scan pipeline uses to skip platform credits + the platform fallback); otherwise it falls
// back to the env-driven platform provider with byom:false. forceMock always wins.
//
// The load-bearing case is the LAST group: "couldn't tell" must never resolve to "no BYOM". Selection
// reads the org's BYOM state ONCE, and an infrastructure failure propagates instead of being caught
// into a platform fallback that would route an enterprise org's private source out of its boundary.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockResolveState } = vi.hoisted(() => ({ mockResolveState: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomState: mockResolveState }));

import { getProviderForOrg } from "@/lib/llm";

beforeEach(() => {
  vi.clearAllMocks();
  // No platform key → the non-BYOM fallback resolves to MockProvider (deterministic for the assertion).
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.LLM_PROVIDER = "auto";
  mockResolveState.mockResolvedValue({ state: "inactive" });
});

describe("getProviderForOrg", () => {
  it("builds a Bedrock provider with the org's creds when BYOM is active (byom:true)", async () => {
    mockResolveState.mockResolvedValue({
      state: "active",
      params: {
        kind: "bedrock",
        model: "us.anthropic.claude-sonnet-4-6",
        region: "eu-west-1",
        credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
      },
    });
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(true);
    expect(provider.name).toBe("bedrock");
    expect(provider.model).toBe("us.anthropic.claude-sonnet-4-6");
    expect(mockResolveState).toHaveBeenCalledWith("acme");
  });

  it("builds an OpenRouter provider for an active openrouter BYOM config", async () => {
    mockResolveState.mockResolvedValue({
      state: "active",
      params: { kind: "openrouter", model: "anthropic/claude-sonnet-4", apiKey: "sk-or-x" },
    });
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(true);
    expect(provider.name).toBe("openrouter");
    expect(provider.model).toBe("anthropic/claude-sonnet-4");
  });

  it("falls back to the platform provider when no active BYOM (byom:false)", async () => {
    mockResolveState.mockResolvedValue({ state: "inactive" });
    const { provider, byom } = await getProviderForOrg("acme");
    expect(byom).toBe(false);
    expect(provider.name).toBe("mock"); // no platform key → mock
  });

  it("reads the org's BYOM state exactly ONCE per selection", async () => {
    // It used to be read twice — resolveByomProvider() and then a disambiguating isByomActive() — each
    // an org lookup + config row + plan read, on every org scan.
    await getProviderForOrg("acme");
    expect(mockResolveState).toHaveBeenCalledTimes(1);
  });

  it("never consults BYOM for the public org", async () => {
    const { byom } = await getProviderForOrg("public");
    expect(byom).toBe(false);
    expect(mockResolveState).not.toHaveBeenCalled();
  });

  it("forceMock wins over everything (no BYOM lookup)", async () => {
    const { provider, byom } = await getProviderForOrg("acme", { forceMock: true });
    expect(byom).toBe(false);
    expect(provider.name).toBe("mock");
    expect(mockResolveState).not.toHaveBeenCalled();
  });
});

describe("getProviderForOrg — fail closed, never out of the customer's boundary", () => {
  it("throws when BYOM is active but its creds can't be resolved (no platform fallback)", async () => {
    // ENCRYPTION_KEY rotated / decrypt failure / tampered blob: a determinate "active but unusable".
    // Routing this org's private source through the env platform provider would breach the in-boundary
    // contract Enterprise paid for, so selection must THROW rather than silently degrade.
    mockResolveState.mockResolvedValue({ state: "unresolvable" });
    await expect(getProviderForOrg("acme")).rejects.toThrow(/BYOM is enabled/i);
  });

  it("does NOT name a specific vendor in that error — an OpenRouter org isn't told to check AWS", async () => {
    mockResolveState.mockResolvedValue({ state: "unresolvable" });
    await expect(getProviderForOrg("acme")).rejects.toThrow(/provider credentials/i);
    await expect(getProviderForOrg("acme")).rejects.not.toThrow(/Amazon Bedrock|AWS boundary/i);
  });

  it("PROPAGATES an infrastructure failure instead of resolving it to 'no BYOM'", async () => {
    // The regression guard. Both reads used to be wrapped in `.catch(() => null/false)`, so a DB blip
    // resolved to "this org has no BYOM" and fell through to the platform provider — the exact breach
    // the fail-closed branch exists to prevent, defeated by the error handling of its own condition.
    mockResolveState.mockRejectedValue(new Error("connection terminated"));
    await expect(getProviderForOrg("acme")).rejects.toThrow(/connection terminated/);
  });
});
