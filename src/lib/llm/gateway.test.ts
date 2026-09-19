// The LightTrack gateway adapter: the OpenRouter transport pointed at localhost, minus the app-side
// fallbacks the gateway owns. Pins the route-as-model contract, the strict json_schema decode, the
// deliberate ABSENCE of a json_object retry (a rejection is terminal for every seat), the attempts
// summary on a gateway-side failure, the fell-back log line, and the shared withLlmTimeout contract.
// fetch is stubbed; no gateway runs here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GATEWAY_URL, GatewayProvider } from "./gateway";
import { ASSESSMENT_SCHEMA_NAME } from "./schema";
import type { LlmScoreInput } from "@/lib/llm/provider";

const input: LlmScoreInput = {
  repo: { owner: "acme", name: "rocket", url: "https://github.com/acme/rocket", stars: 1, forks: 0, defaultBranch: "main" },
  signals: [{ id: "D1", signalScore: 50, signals: [] }],
  files: [],
  commitSample: [],
  archetype: "team",
};

function okResponse(extra: Record<string, unknown> = {}, body: unknown = { dimensions: [{ id: "D1", score: 70 }] }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 11, completion_tokens: 22 },
      lighttrack: { route: "assess", served_by: "anthropic/sonnet@low", fell_back: false, attempts: [] },
      ...extra,
    }),
  } as unknown as Response;
}

function errorResponse(status: number, text: string) {
  return { ok: false, status, text: async () => text } as unknown as Response;
}

function callOf(fetchMock: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetchMock.mock.calls[n]! as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GatewayProvider.assess — the route is the model", () => {
  it("POSTs the OpenAI shape to the local gateway with model = the route and a strict json_schema", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const p = new GatewayProvider();
    expect(p.name).toBe("gateway");
    expect(p.model).toBe("assess");
    const assessment = await p.assess(input);

    const { url, init, body } = callOf(fetchMock);
    expect(url).toBe(`${DEFAULT_GATEWAY_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer \S+$/);
    expect(body.model).toBe("assess");
    const rf = body.response_format as { type: string; json_schema: { name: string; strict: boolean } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe(ASSESSMENT_SCHEMA_NAME);
    expect(rf.json_schema.strict).toBe(true);
    // One user turn with the system text folded in: the Codex seat caps a system message at 16000
    // chars on its command line, and the assessment prefix is longer — see gateway.ts.
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["user"]);
    expect(messages[0]!.content).toMatch(/^You are Ascent/);
    expect(messages[0]!.content).toContain("\n\n---\n\n");
    expect(messages[0]!.content).toContain("acme/rocket");
    expect(assessment.dimensions[0]).toMatchObject({ id: "D1", score: 70 });
  });

  it("honours LIGHTTRACK_GATEWAY_URL and LIGHTTRACK_GATEWAY_ROUTE", async () => {
    vi.stubEnv("LIGHTTRACK_GATEWAY_URL", "http://127.0.0.1:9999/v1/");
    vi.stubEnv("LIGHTTRACK_GATEWAY_ROUTE", "assess-canary");
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await new GatewayProvider().assess(input);

    const { url, body } = callOf(fetchMock);
    expect(url).toBe("http://127.0.0.1:9999/v1/chat/completions");
    expect(body.model).toBe("assess-canary");
  });

  it("does NOT retry a rejected request on json_object — a rejection is terminal for every seat", async () => {
    const fetchMock = vi.fn(async () =>
      errorResponse(400, '{"error":{"message":"response_format json_schema rejected","type":"invalid_request_error"}}'),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GatewayProvider().assess(input)).rejects.toThrow(
      /gateway request failed \(400\): response_format json_schema rejected/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names every attempt the gateway made when the whole route failed (503)", async () => {
    const fetchMock = vi.fn(async () =>
      errorResponse(
        503,
        JSON.stringify({
          error: { message: "every target failed" },
          lighttrack: {
            attempts: [
              { target: "anthropic/sonnet@low", outcome: "exhausted" },
              { target: "codex/gpt-5.5@low", outcome: "transient" },
            ],
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GatewayProvider().assess(input)).rejects.toThrow(
      "LightTrack gateway request failed (503): every target failed [anthropic/sonnet@low: exhausted, codex/gpt-5.5@low: transient]",
    );
  });

  it("logs (and never branches on) a fall-back to the other seat", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          lighttrack: {
            route: "assess",
            served_by: "codex/gpt-5.5@low",
            fell_back: true,
            attempts: [
              { target: "anthropic/sonnet@low", outcome: "exhausted" },
              { target: "codex/gpt-5.5@low", outcome: "ok" },
            ],
          },
        }),
      ),
    );

    const assessment = await new GatewayProvider().assess(input);

    expect(assessment.dimensions[0]).toMatchObject({ id: "D1", score: 70 });
    expect(info).toHaveBeenCalledWith(expect.stringContaining("fell back to codex/gpt-5.5@low"));
  });

  it("rejects an answer that is not an assessment object (the shape guard stays the outer net)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({}, [1, 2, 3])));
    await expect(new GatewayProvider().assess(input)).rejects.toThrow(/not an assessment object/);
  });
});

describe("GatewayProvider.assess — cancellation (shared withLlmTimeout)", () => {
  const hangingFetch = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (!sig) return;
        if (sig.aborted) return reject(sig.reason);
        sig.addEventListener("abort", () => reject(sig.reason), { once: true });
      }),
  );

  it("aborts a hung request at LIGHTTRACK_GATEWAY_TIMEOUT_MS (a seat session, not the 60s hosted default)", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("LIGHTTRACK_GATEWAY_TIMEOUT_MS", "5000");
      vi.stubGlobal("fetch", hangingFetch);
      const outcome = new GatewayProvider().assess(input).then(
        () => "resolved",
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(((await outcome) as Error).message).toBe("LightTrack gateway request timed out.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer and meters usage on success", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
      const onUsage = vi.fn();
      const outcome = new GatewayProvider().assess(input, { onUsage });
      await vi.advanceTimersByTimeAsync(0);
      await outcome;
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 11, outputTokens: 22 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
