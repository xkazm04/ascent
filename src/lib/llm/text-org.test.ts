// The org-aware text seam. The gap it closes: resolveTextRunner reads only env, so a deployment whose
// orgs all run BYOM — no platform key at all, the shape an enterprise buys when it connects its own
// Bedrock account — got `null` from every non-scan LLM surface. Scans ran on the org's own model while
// Shared Org Memory reported "no engine" forever, for the customers paying the most.
//
// Selection must mirror getProviderForOrg, fail-closed rule included: this seam carries org memory
// content, which is no less private than repo source.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockResolveState } = vi.hoisted(() => ({ mockResolveState: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomState: mockResolveState }));

import { resolveTextRunnerForOrg } from "@/lib/llm/text-org";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveState.mockResolvedValue({ state: "inactive" });
  vi.stubEnv("LLM_PROVIDER", "auto");
  vi.stubEnv("GEMINI_API_KEY", undefined);
  vi.stubEnv("GOOGLE_API_KEY", undefined);
  vi.stubEnv("OPENROUTER_API_KEY", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveTextRunnerForOrg — a BYOM org gets an engine", () => {
  it("uses the org's OpenRouter key even with NO platform key configured", async () => {
    mockResolveState.mockResolvedValue({
      state: "active",
      params: { kind: "openrouter", model: "anthropic/claude-sonnet-4", apiKey: "sk-or-org" },
    });
    const runner = await resolveTextRunnerForOrg("acme");
    expect(runner).not.toBeNull();
    expect(runner!.engine).toBe("openrouter");
    expect(runner!.model).toBe("anthropic/claude-sonnet-4");
  });

  it("sends the ORG's key, not the platform's, on the wire", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-PLATFORM");
    mockResolveState.mockResolvedValue({
      state: "active",
      params: { kind: "openrouter", model: "openai/gpt-4o-mini", apiKey: "sk-or-ORG" },
    });
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "hi" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const runner = await resolveTextRunnerForOrg("acme");
    await runner!.run("prompt");

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-or-ORG");
  });

  it("uses the org's Bedrock model + region for a bedrock BYOM config", async () => {
    mockResolveState.mockResolvedValue({
      state: "active",
      params: {
        kind: "bedrock",
        model: "eu.anthropic.claude-sonnet-4-6",
        region: "eu-west-1",
        credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
      },
    });
    const runner = await resolveTextRunnerForOrg("acme");
    expect(runner!.engine).toBe("bedrock");
    expect(runner!.model).toBe("eu.anthropic.claude-sonnet-4-6");
  });
});

describe("resolveTextRunnerForOrg — unchanged behavior everywhere else", () => {
  it("falls back to the env runner when the org has no BYOM", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    const runner = await resolveTextRunnerForOrg("acme");
    expect(runner!.engine).toBe("gemini");
  });

  it("still returns null when neither BYOM nor a platform key exists", async () => {
    expect(await resolveTextRunnerForOrg("acme")).toBeNull();
  });

  it("never consults BYOM for the public org (or no org)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    await resolveTextRunnerForOrg("public");
    await resolveTextRunnerForOrg(null);
    expect(mockResolveState).not.toHaveBeenCalled();
  });
});

describe("resolveTextRunnerForOrg — fail closed", () => {
  it("throws rather than falling back to the platform when BYOM is active but unresolvable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g"); // a platform engine IS available — it must still not be used
    mockResolveState.mockResolvedValue({ state: "unresolvable" });
    await expect(resolveTextRunnerForOrg("acme")).rejects.toThrow(/BYOM is enabled/i);
  });

  it("propagates an infrastructure failure instead of resolving it to 'no BYOM'", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    mockResolveState.mockRejectedValue(new Error("connection terminated"));
    await expect(resolveTextRunnerForOrg("acme")).rejects.toThrow(/connection terminated/);
  });
});
