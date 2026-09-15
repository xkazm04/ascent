// The hosted text seam — "prompt in → model text out" against the SAME provider selection the scan
// pipeline uses. What matters here is RESOLUTION, not transport: no request is ever issued.
//
// The bug this file guards against is the one it was written to fix: the only text engine in the
// codebase was the local `claude` CLI, so every non-scan LLM surface (the memory write-gate, reflect)
// resolved to null in production and was structurally dead there.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resolveTextRunner, textRunnerFrom } from "@/lib/llm/text";
import { setMeterSink, type UsageEventInput } from "@/lib/llm/meter";
import type { ResolvedLegRunner } from "@/lib/llm/leg";

// `legKind` is a REQUIRED option — there is no default — so every call here names the surface it is
// standing in for. These tests stand in for Shared Org Memory's passes.
const MEMORY = { legKind: "memory" } as const;

const ENV_KEYS = [
  "LLM_PROVIDER",
  "NODE_ENV",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "BEDROCK_REGION",
  "LOCAL_LLM_BASE_URL",
  "LOCAL_LLM_MODEL",
] as const;

const setEnv = (patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => {
  for (const k of ENV_KEYS) vi.stubEnv(k, patch[k] as string);
};

afterEach(() => vi.unstubAllEnvs());

describe("resolveTextRunner", () => {
  it("resolves a HOSTED runner in a production build — the whole point", async () => {
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    const runner = await resolveTextRunner(MEMORY);
    expect(runner?.engine).toBe("gemini");
    expect(typeof runner?.run).toBe("function");
  });

  it("honors each explicit hosted selection when its prerequisite is present", async () => {
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    expect((await resolveTextRunner(MEMORY))?.engine).toBe("openai");

    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    expect((await resolveTextRunner(MEMORY))?.engine).toBe("openrouter");

    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "bedrock", BEDROCK_REGION: "us-east-1" });
    expect((await resolveTextRunner(MEMORY))?.engine).toBe("bedrock");
  });

  it("returns null rather than SUBSTITUTING a provider the operator did not choose", async () => {
    // Explicitly selected, prerequisite absent: "no engine" is the honest answer, not a silent swap.
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openai", GEMINI_API_KEY: "k" });
    expect(await resolveTextRunner(MEMORY)).toBeNull();
  });

  it("returns null for mock and for claude-cli on a production host", async () => {
    setEnv({ LLM_PROVIDER: "mock" });
    expect(await resolveTextRunner(MEMORY)).toBeNull();

    // Mirrors providerAvailable("claude-cli"): the prod build dead-code-prunes the CLI module away.
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "claude-cli" });
    expect(await resolveTextRunner(MEMORY)).toBeNull();
  });

  // `local` had NO case in the switch, so it fell through to `default: -> null` even though
  // providerAvailable("local") returns true once both knobs are set — meaning a self-hoster on Ollama
  // got "no engine" from every non-scan LLM surface while their scans ran fine on the same server.
  it("resolves a runner for LLM_PROVIDER=local — the self-hoster's whole path", async () => {
    setEnv({
      NODE_ENV: "production",
      LLM_PROVIDER: "local",
      LOCAL_LLM_BASE_URL: "http://localhost:11434/v1",
      LOCAL_LLM_MODEL: "qwen2.5-coder:14b",
    });
    const runner = await resolveTextRunner(MEMORY);
    expect(runner?.engine).toBe("local");
    expect(runner?.model).toBe("qwen2.5-coder:14b");
  });

  it("follows getProvider()'s `auto` rule: Gemini with a key, otherwise nothing", async () => {
    setEnv({ LLM_PROVIDER: undefined, GEMINI_API_KEY: "k" });
    expect((await resolveTextRunner(MEMORY))?.engine).toBe("gemini");

    setEnv({ LLM_PROVIDER: undefined });
    expect(await resolveTextRunner(MEMORY)).toBeNull();
  });
});

// These are REAL billed model calls, and until metering landed they were the ONLY LLM traffic in the
// app no meter could see: no onUsage, no tracklight event — so Shared Org Memory's spend appeared
// nowhere in /usage, the cost estimate, or the observability mirror, while every scan-path call was
// fully accounted. Metering lives in the seam (not the callers) so a caller cannot forget it.
describe("resolveTextRunner — every call is metered", () => {
  /** Resolve an OpenAI runner with tracklight on, stubbing fetch for both the model + event POSTs. */
  async function openAiRunner(modelResponse: () => Response) {
    setEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    vi.stubEnv("LIGHTTRACK_ENABLED", "1");
    const events: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/v1/events")) {
          events.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        return modelResponse();
      }),
    );
    const runner = await resolveTextRunner({ ...MEMORY, onUsage });
    return { runner: runner!, events };
  }
  const onUsage = vi.fn();
  /** The tracklight POST is detached — let the microtask queue drain before asserting. */
  const settle = () => new Promise((res) => setTimeout(res, 0));

  afterEach(() => {
    vi.unstubAllGlobals();
    onUsage.mockClear();
  });

  it("reports token usage to onUsage from the provider's response", async () => {
    const { runner } = await openAiRunner(() =>
      Response.json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }),
    );
    await runner.run("prompt");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 11, outputTokens: 4 }));
  });

  it("mirrors a successful call to tracklight under its LEG KIND, not 'scan' or a blanket 'text'", async () => {
    const { runner, events } = await openAiRunner(() =>
      Response.json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    );
    await runner.run("prompt");
    await settle();

    expect(events).toHaveLength(1);
    const body = events[0] as { tags: string[]; operation: string; status: string; usage: Record<string, number> };
    // Tagging these "scan" would quietly inflate scan cost/latency rollups with another surface's
    // traffic; the old blanket "text" tag merged every non-scan surface into one indistinguishable
    // bucket, which is exactly what the required legKind exists to prevent.
    expect(body.tags).toContain("memory");
    expect(body.tags).not.toContain("scan");
    expect(body.tags).not.toContain("text");
    expect(body.operation).toBe("text");
    expect(body.status).toBe("success");
    expect(body.usage).toMatchObject({ input: 7, output: 2 });
  });

  it("meters FAILURES too — an endpoint erroring on every pass is what telemetry is for", async () => {
    const { runner, events } = await openAiRunner(() => new Response("upstream exploded", { status: 500 }));
    await expect(runner.run("prompt")).rejects.toThrow(/OpenAI request failed/);
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "error" });
    expect(String((events[0] as { error: string }).error)).toMatch(/OpenAI request failed/);
  });

  it("a caller that passes no onUsage is unaffected — metering is optional for the caller", async () => {
    setEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "hi" } }] })));
    const runner = await resolveTextRunner(MEMORY);
    await expect(runner!.run("prompt")).resolves.toBe("hi");
  });
});

// The DURABLE half of the same seam (#11): one UsageEvent per single-shot call. tracklight is an
// optional local mirror; this ledger is what /usage reads, so it has to fire on the same edges.
describe("resolveTextRunner — every call posts exactly one ledger event", () => {
  const posted: UsageEventInput[] = [];
  beforeEach(() => {
    posted.length = 0;
    setMeterSink(async (e) => void posted.push(e));
  });
  afterEach(() => setMeterSink(null));

  const METERED = { ...MEMORY, meter: { orgSlug: "acme" } } as const;

  it("posts ONE priced event for a successful call, under the leg kind's lane", async () => {
    setEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 11, completion_tokens: 4 } }),
      ),
    );
    const runner = await resolveTextRunner(METERED);
    await runner!.run("prompt");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ orgSlug: "acme", lane: "memory", legKind: "memory", status: "success", inputTokens: 11, outputTokens: 4 });
  });

  it("posts a token-less event for a FAILED call — a lane that keeps erroring must be visible", async () => {
    setEnv({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream exploded", { status: 500 })));
    const runner = await resolveTextRunner(METERED);
    await expect(runner!.run("prompt")).rejects.toThrow(/OpenAI request failed/);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ status: "error", inputTokens: null, outputTokens: null, costMicros: null });
  });

  it("meters the claude-cli (ownsTimeout) path with HONEST NULLS rather than skipping it", async () => {
    // That transport reports no usage at all, so its cost is not knowable from here. The call still
    // happened: a null cost is the honest record, a missing row would read as a lane that never ran.
    const leg: ResolvedLegRunner = {
      engine: "claude-cli",
      model: "sonnet",
      ownsTimeout: true,
      call: async () => ({ text: "hi" }),
    };
    const runner = textRunnerFrom(leg, 1_000, METERED);
    await expect(runner.run("prompt")).resolves.toBe("hi");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ provider: "claude-cli", inputTokens: null, costMicros: null, status: "success" });
  });
});
