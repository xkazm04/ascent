// First direct tests for the OpenRouter adapter — the fleet path the baked model matrix is measured
// on. Pins the strict json_schema decode (docs/features/scanning/llm-model-matrix.md attributes glm/deepseek/sonnet's
// low reliability to json_object-only decoding), the per-upstream fallback so no previously-working
// model starts hard-failing, and the shared withLlmTimeout cancellation contract. fetch is stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProvider } from "./openrouter";
import { ASSESSMENT_SCHEMA_NAME } from "./schema";
import type { LlmScoreInput } from "@/lib/llm/provider";

const input: LlmScoreInput = {
  repo: { owner: "acme", name: "rocket", url: "https://github.com/acme/rocket", stars: 1, forks: 0, defaultBranch: "main" },
  signals: [{ id: "D1", signalScore: 50, signals: [] }],
  files: [],
  commitSample: [],
  archetype: "team",
};

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

function okResponse(body: unknown = { dimensions: [{ id: "D1", score: 70 }] }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
    }),
  } as unknown as Response;
}

function errorResponse(status: number, text: string) {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const init = fetchMock.mock.calls[n]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OpenRouterProvider.assess — schema-constrained decode", () => {
  it("requests STRICT json_schema (OpenRouter proxies OpenAI's response_format contract)", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await new OpenRouterProvider({ model: "anthropic/claude-sonnet-5" }).assess(input);

    const rf = bodyOf(fetchMock).response_format as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: { additionalProperties: boolean } };
    };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe(ASSESSMENT_SCHEMA_NAME);
    expect(rf.json_schema.strict).toBe(true);
    expect(rf.json_schema.schema.additionalProperties).toBe(false);
    // Attribution headers are unchanged by the decode switch.
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Title"]).toBe("Ascent");
  });

  it("falls back ONCE to json_object when an upstream refuses the format", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, '{"error":{"message":"response_format json_schema is not supported by this model"}}'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const assessment = await new OpenRouterProvider({ model: "z-ai/glm-5.2" }).assess(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 1).response_format).toEqual({ type: "json_object" });
    expect(assessment.dimensions[0]).toMatchObject({ id: "D1", score: 70 });
    expect(warn).toHaveBeenCalled();
  });

  it("does NOT retry a credit/auth failure — it stays a loud error", async () => {
    const fetchMock = vi.fn(async () => errorResponse(402, "Insufficient credits"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenRouterProvider().assess(input)).rejects.toThrow(/OpenRouter request failed \(402\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenRouterProvider.assess — cancellation (shared withLlmTimeout)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const hangingFetch = vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const sig = init?.signal;
      if (!sig) return;
      if (sig.aborted) return reject(sig.reason);
      sig.addEventListener("abort", () => reject(sig.reason), { once: true });
    }),
  );

  it("aborts a hung request at LLM_TIMEOUT_MS", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    const outcome = new OpenRouterProvider().assess(input).then(
      () => "resolved",
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(((await outcome) as Error).message).toBe("OpenRouter request timed out.");
  });

  it("clears the timeout timer and meters usage on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    const onUsage = vi.fn();
    const outcome = new OpenRouterProvider().assess(input, { onUsage });
    await vi.advanceTimersByTimeAsync(0);
    await outcome;
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 11, outputTokens: 22 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
