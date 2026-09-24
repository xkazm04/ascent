import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_LABEL, isZeroCostProvider } from "@/lib/llm/config";
import { NEBIUS_DEFAULT_BASE_URL, NebiusProvider, nebiusConfigured, testNebiusConnection } from "@/lib/llm/nebius";

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

describe("testNebiusConnection — the BYOM pre-flight (backlog row 37)", () => {
  const reply = (content: string) => vi.fn(async () => Response.json({ choices: [{ message: { content } }] }));

  it("sends a JSON-mode request with the ORG's key to the public endpoint, never the host's override", async () => {
    process.env.NEBIUS_BASE_URL = "https://platform-proxy.example/v1";
    process.env.NEBIUS_API_KEY = "nb-PLATFORM";
    const fetchMock = reply('{"ok":true}');
    vi.stubGlobal("fetch", fetchMock);
    expect(await testNebiusConnection({ model: "zai-org/GLM-5.3-Flash", apiKey: "nb-ORG" })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${NEBIUS_DEFAULT_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer nb-ORG");
    const body = JSON.parse(String(init.body));
    expect([body.model, body.response_format]).toEqual(["zai-org/GLM-5.3-Flash", { type: "json_object" }]);
    vi.unstubAllGlobals();
  });

  it("fails a model that answers in prose, which would degrade every real scan to the floor", async () => {
    vi.stubGlobal("fetch", reply("Thinking: 1. the user wants OK"));
    const r = await testNebiusConnection({ model: "nvidia/Nemotron-3_5-Lightning", apiKey: "nb" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON object/);
    vi.unstubAllGlobals();
  });

  it("reports a vendor rejection without echoing the key, and needs both a key and a model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const r = await testNebiusConnection({ model: "m", apiKey: "nb-SECRET" });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Nebius request failed \(401\)/);
    expect(r.error).not.toContain("nb-SECRET");
    expect((await testNebiusConnection({ model: "m", apiKey: " " })).ok).toBe(false);
    expect((await testNebiusConnection({ model: " ", apiKey: "k" })).error).toMatch(/model/i);
    vi.unstubAllGlobals();
  });
});
