import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_LABEL, isZeroCostProvider } from "@/lib/llm/config";
import { NEBIUS_DEFAULT_BASE_URL, NebiusProvider, nebiusConfigured } from "@/lib/llm/nebius";

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("nebius availability", () => {
  it("requires BOTH the key and the model, matching the provider's own guard", () => {
    process.env.NEBIUS_API_KEY = "";
    process.env.NEBIUS_MODEL = "";
    expect(nebiusConfigured()).toBe(false);

    process.env.NEBIUS_API_KEY = "k";
    expect(nebiusConfigured()).toBe(false);

    process.env.NEBIUS_MODEL = "zai-org/GLM-5.3-Flash";
    expect(nebiusConfigured()).toBe(true);
  });

  it("does not invent a default model", async () => {
    process.env.NEBIUS_API_KEY = "k";
    delete process.env.NEBIUS_MODEL;
    const p = new NebiusProvider();
    // A guessed default would 404 on an account that never enabled it; a named variable is the
    // better first run.
    await expect(p.assess({} as never)).rejects.toThrow(/NEBIUS_MODEL/);
  });

  it("defaults the endpoint to the public Token Factory URL", () => {
    expect(NEBIUS_DEFAULT_BASE_URL).toBe("https://api.tokenfactory.nebius.com/v1");
  });
});

describe("nebius identity", () => {
  // The whole reason this is not `LLM_PROVIDER=local` with a different base URL.
  it("is NOT a zero-cost provider", () => {
    expect(isZeroCostProvider("local")).toBe(true);
    expect(isZeroCostProvider("nebius")).toBe(false);
  });

  it("carries its own provenance label rather than borrowing OpenAI's", () => {
    expect(PROVIDER_LABEL.nebius).toBe("Nebius");
    expect(PROVIDER_LABEL.nebius).not.toBe(PROVIDER_LABEL.openai);
    expect(PROVIDER_LABEL.nebius).not.toBe(PROVIDER_LABEL.local);
  });

  it("reports itself as `nebius`, so /usage attributes the scan to the right engine", () => {
    process.env.NEBIUS_API_KEY = "k";
    process.env.NEBIUS_MODEL = "MiniMaxAI/MiniMax-M3";
    expect(new NebiusProvider().name).toBe("nebius");
  });
});
