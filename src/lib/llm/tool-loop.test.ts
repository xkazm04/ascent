// The tool loop. Four properties matter more than the plumbing, and each has a test here:
//   1. it never fabricates a final answer (running out of legs/budget truncates, it does not invent);
//   2. it says HOW the answer was grounded ("tools" vs "prefetched") and never substitutes silently;
//   3. usage SUMS across legs (scan-assess.ts's last-wins is right for retries and wrong for legs);
//   4. exactly ONE tracklight event per loop, tagged with the leg kind.
// No network: the AWS SDK is stubbed at the module boundary, everything else runs for real.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { runToolLoop, ATHENA_MAX_LEGS } from "@/lib/llm/tool-loop";
import { LlmHttpError } from "@/lib/llm/transports";
import type { ResolvedLegRunner } from "@/lib/llm/text";
import type { LegResult } from "@/lib/llm/leg";

const TOOLS = [{ name: "org_repos", description: "List repos", inputSchema: { type: "object" } }];

const sent: Record<string, unknown>[] = [];
let bedrockReplies: unknown[] = [];
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  ConverseCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  BedrockRuntimeClient: class {
    async send(cmd: { input: Record<string, unknown> }) {
      sent.push(cmd.input);
      if (!bedrockReplies.length) throw new Error("stub ran out of replies");
      return bedrockReplies.shift();
    }
  },
}));

/** Tracklight events captured off the detached POST. */
let events: Record<string, unknown>[] = [];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  events = [];
  vi.stubEnv("LIGHTTRACK_ENABLED", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/v1/events")) events.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => {
  sent.length = 0;
  bedrockReplies = [];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A runner that replays a canned script of leg results (or throws a canned error). */
function stubRunner(script: (LegResult | Error)[], engine: ResolvedLegRunner["engine"] = "bedrock"): ResolvedLegRunner {
  return {
    engine,
    model: "stub-model",
    call: async () => {
      const next = script.shift();
      if (!next) throw new Error("stub ran out of replies");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

describe("a two-leg Bedrock exchange, end to end over a stubbed transport", () => {
  it("calls the tool, feeds the result back, and answers in prose", async () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    vi.stubEnv("BEDROCK_REGION", "us-east-1");
    bedrockReplies = [
      {
        output: { message: { content: [{ toolUse: { toolUseId: "tu_1", name: "org_repos", input: { limit: 5 } } }] } },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      {
        output: { message: { content: [{ text: "Two repositories are failing their gate." }] } },
        usage: { inputTokens: 50, outputTokens: 10 },
      },
    ];
    const execute = vi.fn(async () => '{"failing":2}');

    const res = await runToolLoop({ prompt: "what is failing?", tools: TOOLS, execute, legKind: "athena_turn" });

    expect(res).not.toBeNull();
    expect(res!.text).toBe("Two repositories are failing their gate.");
    expect(res!.legs).toBe(2);
    expect(res!.truncated).toBe(false);
    expect(res!.grounding).toBe("tools");
    expect(res!.engine).toBe("bedrock");
    expect(res!.toolCalls).toEqual([{ name: "org_repos", args: { limit: 5 } }]);
    expect(execute).toHaveBeenCalledWith({ id: "tu_1", name: "org_repos", args: { limit: 5 } });

    // Second leg carries the whole exchange: original prompt, the assistant's toolUse, the toolResult.
    const messages = (sent[1] as { messages: Record<string, unknown>[] }).messages;
    expect(messages).toHaveLength(3);
  });

  it("SUMS usage across legs and emits exactly ONE tracklight event, tagged by leg kind", async () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    vi.stubEnv("BEDROCK_REGION", "us-east-1");
    bedrockReplies = [
      {
        output: { message: { content: [{ toolUse: { toolUseId: "tu_1", name: "org_repos", input: {} } }] } },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      { output: { message: { content: [{ text: "done" }] } }, usage: { inputTokens: 50, outputTokens: 10 } },
    ];
    const onUsage = vi.fn();
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => "{}",
      legKind: "athena_turn",
      onUsage,
    });
    await settle();

    // Last-wins (scan-assess.ts:209) would have reported 50/10 here — an undercount of a real bill.
    expect(res!.usage).toEqual({ inputTokens: 150, outputTokens: 30 });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 150, outputTokens: 30 });

    expect(events).toHaveLength(1);
    const body = events[0] as { tags: string[]; usage: Record<string, number>; operation: string };
    expect(body.usage).toEqual({ input: 150, output: 30 });
    expect(body.tags).toContain("athena_turn");
    expect(body.tags).toContain("grounding:tools");
    expect(body.tags).not.toContain("scan");
    expect(body.operation).toBe("tool-loop");
  });
});

describe("it never fabricates a final answer", () => {
  it("truncates at the leg ceiling rather than inventing a closing paragraph", async () => {
    const toolLeg = (): LegResult => ({
      text: "",
      usage: { inputTokens: 10, outputTokens: 1 },
      toolCalls: [{ id: "t", name: "org_repos", args: {} }],
    });
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => "{}",
      legKind: "athena_turn",
      runner: stubRunner([toolLeg(), toolLeg(), toolLeg(), toolLeg(), toolLeg()]),
    });
    expect(res!.legs).toBe(ATHENA_MAX_LEGS);
    expect(res!.truncated).toBe(true);
    expect(res!.text).toBe(""); // nothing invented
    expect(res!.usage).toEqual({ inputTokens: 40, outputTokens: 4 });
  });

  it("truncates on the cross-leg budget instead of letting N legs cost N x the per-call timeout", async () => {
    const slowRunner: ResolvedLegRunner = {
      engine: "bedrock",
      model: "stub-model",
      call: (_req, signal) =>
        new Promise((_res, rej) => signal?.addEventListener("abort", () => rej(signal.reason), { once: true })),
    };
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => "{}",
      legKind: "athena_cycle",
      budgetMs: 1_000,
      runner: slowRunner,
    });
    await settle();
    expect(res!.truncated).toBe(true);
    expect(res!.text).toBe("");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "timeout" });
  }, 10_000);

  it("a tool that throws is reported to the model, not crashed on", async () => {
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => {
        throw new Error("permission denied");
      },
      legKind: "athena_turn",
      runner: stubRunner([
        { text: "", toolCalls: [{ id: "t", name: "org_repos", args: {} }] },
        { text: "I could not read that." },
      ]),
    });
    expect(res!.text).toBe("I could not read that.");
    expect(res!.truncated).toBe(false);
  });
});

describe("grounding is always disclosed, never silently substituted", () => {
  it("reports 'prefetched' for a provider that cannot be handed tools at all (claude-cli)", async () => {
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => "{}",
      legKind: "athena_turn",
      runner: stubRunner([{ text: "an answer from the prompt alone" }], "claude-cli"),
    });
    expect(res!.grounding).toBe("prefetched");
    expect(res!.legs).toBe(1);
  });

  it("falls back ONCE, loudly, when an OpenAI-compatible endpoint 4xxs on `tools`", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await runToolLoop({
      prompt: "p",
      tools: TOOLS,
      execute: async () => "{}",
      legKind: "athena_turn",
      runner: stubRunner(
        [new LlmHttpError(400, '{"error":"tools is not supported by this model"}', "boom"), { text: "plain answer" }],
        "local",
      ),
    });
    expect(res!.grounding).toBe("prefetched");
    expect(res!.text).toBe("plain answer");
    expect(res!.legs).toBe(1); // the rejected attempt spent no tokens, so it is not a leg
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/stub-model.*rejected tool calling/s));
  });

  it("a genuine failure still surfaces — it is not swallowed as a degrade", async () => {
    await expect(
      runToolLoop({
        prompt: "p",
        tools: TOOLS,
        execute: async () => "{}",
        legKind: "athena_turn",
        runner: stubRunner([new LlmHttpError(401, "invalid api key", "OpenAI request failed (401)")], "openai"),
      }),
    ).rejects.toThrow(/OpenAI request failed/);
    await settle();
    // Still exactly one event — a failed loop is exactly what telemetry is for.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: "error" });
  });
});

describe("no engine is a first-class answer", () => {
  it("returns null rather than pretending, when nothing is configured", async () => {
    vi.stubEnv("LLM_PROVIDER", "mock");
    expect(
      await runToolLoop({ prompt: "p", tools: TOOLS, execute: async () => "{}", legKind: "athena_turn" }),
    ).toBeNull();
  });
});
