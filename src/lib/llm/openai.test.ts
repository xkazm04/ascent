// First direct tests for the OpenAI-compatible adapter. Pins the schema-constrained decode
// (llm-provider-abstraction / perfect wave: strict json_schema derived from ASSESSMENT_JSON_SCHEMA
// instead of bare json_object, which guaranteed valid JSON but not the assessment SHAPE), its
// graceful per-target fallback, and the shared withLlmTimeout cancellation contract. No live call:
// global fetch is stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./openai";
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

/** The minimum well-formed chat/completions answer carrying a usable assessment. */
function okResponse(body: unknown = { dimensions: [{ id: "D1", score: 70 }] }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  } as unknown as Response;
}

function errorResponse(status: number, text: string) {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

/** Parse the JSON request body of the n-th stubbed fetch call. */
function bodyOf(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const init = fetchMock.mock.calls[n]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OpenAiProvider.assess — schema-constrained decode", () => {
  it("requests STRICT json_schema built from the assessment contract", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAiProvider({ model: "gpt-4o-mini" }).assess(input);

    const rf = bodyOf(fetchMock).response_format as {
      type: string;
      json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
    };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe(ASSESSMENT_SCHEMA_NAME);
    expect(rf.json_schema.strict).toBe(true);
    // Derived from ASSESSMENT_JSON_SCHEMA, strictified: closed objects, every key required.
    const schema = rf.json_schema.schema as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { items?: { additionalProperties?: boolean; required?: string[] } }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["headline", "dimensions", "roadmap", "discrepancies"]));
    expect(schema.properties.dimensions!.items!.additionalProperties).toBe(false);
    // Optional source fields (explore/levelUnlock) become required-but-nullable, strict mode's only
    // way to express optionality.
    const roadmapItem = schema.properties.roadmap!.items as {
      required: string[];
      properties: Record<string, { type: string | string[] }>;
    };
    expect(roadmapItem.required).toEqual(expect.arrayContaining(["title", "explore", "levelUnlock"]));
    expect(roadmapItem.properties.levelUnlock!.type).toEqual(["string", "null"]);
    expect(roadmapItem.properties.title!.type).toBe("string");
  });

  it("falls back ONCE to json_object when the target rejects the format with a 400", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "Invalid parameter: 'response_format.json_schema' is not supported."))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const assessment = await new OpenAiProvider({ model: "local-llama" }).assess(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((bodyOf(fetchMock, 0).response_format as { type: string }).type).toBe("json_schema");
    expect(bodyOf(fetchMock, 1).response_format).toEqual({ type: "json_object" });
    expect(assessment.dimensions[0]).toMatchObject({ id: "D1", score: 70 });
    expect(warn).toHaveBeenCalled();
  });

  it("does NOT retry an unrelated failure — it stays a loud error", async () => {
    const fetchMock = vi.fn(async () => errorResponse(401, "Incorrect API key provided."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAiProvider().assess(input)).rejects.toThrow(/OpenAI request failed \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a second failure on the fallback path instead of hanging", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "response_format json_schema unsupported"))
      .mockResolvedValueOnce(errorResponse(500, "upstream exploded"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAiProvider().assess(input)).rejects.toThrow(/OpenAI request failed \(500\)/);
  });
});

describe("OpenAiProvider.assess — cancellation (shared withLlmTimeout)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A fetch that only settles when the passed AbortSignal fires. */
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
    const outcome = new OpenAiProvider().assess(input).then(
      () => "resolved",
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("OpenAI request timed out.");
  });

  it("aborts on client disconnect too (the two signals are combined)", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    const ctrl = new AbortController();
    const outcome = new OpenAiProvider().assess(input, { signal: ctrl.signal }).then(
      () => "resolved",
      (err: unknown) => err,
    );
    ctrl.abort(new Error("client disconnected"));
    await vi.advanceTimersByTimeAsync(0);
    const err = await outcome;
    expect((err as Error).message).toBe("client disconnected");
  });

  it("clears the timeout timer and meters usage on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
    const onUsage = vi.fn();
    const outcome = new OpenAiProvider().assess(input, { onUsage });
    await vi.advanceTimersByTimeAsync(0);
    await outcome;
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
