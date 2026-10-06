// Regression tests for the Bedrock per-call timeout (biz-bug-scan-2026-06-11, llm finding #3):
// Bedrock was the only provider with no per-call timeout, so one hung Converse call ran until
// scan.ts's 90s total LLM budget expired — structurally starving the retry + failover steps for
// the enterprise path. assess() must CANCEL the call at LLM_TIMEOUT_MS (the W6-2
// AbortController pattern shared with gemini/openai). No live AWS call: the SDK is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BedrockProvider, DEFAULT_BEDROCK_REGION, isValidAwsRegion, resolveBedrockRegion, testBedrockConnection } from "./bedrock";
import { ASSESSMENT_TOOL_NAME } from "./schema";
import type { LlmScoreInput } from "@/lib/llm/provider";

const h = vi.hoisted(() => ({
  send: undefined as
    | undefined
    | ((cmd: unknown, opts?: { abortSignal?: AbortSignal }) => Promise<unknown>),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send(cmd: unknown, opts?: { abortSignal?: AbortSignal }) {
      return h.send!(cmd, opts);
    }
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}));

// Mirrors the module-level read in bedrock.ts so the test holds even if the runner env tunes it.
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

/** A send() that never resolves on its own and rejects only when the abort signal fires. */
const hangingSend = (_cmd: unknown, opts?: { abortSignal?: AbortSignal }) =>
  new Promise<never>((_resolve, reject) => {
    const sig = opts?.abortSignal;
    if (!sig) return; // hangs forever — the timeout test would fail loudly
    if (sig.aborted) return reject(sig.reason);
    sig.addEventListener("abort", () => reject(sig.reason), { once: true });
  });

const input: LlmScoreInput = {
  repo: {
    owner: "acme",
    name: "rocket",
    url: "https://github.com/acme/rocket",
    stars: 1,
    forks: 0,
    defaultBranch: "main",
  },
  signals: [{ id: "D1", signalScore: 50, signals: [] }],
  files: [],
  commitSample: [],
  archetype: "team",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  h.send = undefined;
});

/** Capture the ConverseCommand input the provider/test-connection hands to send(). */
type Captured = {
  toolConfig?: { tools?: { toolSpec?: { name?: string } }[]; toolChoice?: unknown };
  inferenceConfig?: { maxTokens?: number };
};

describe("BedrockProvider.assess — per-call timeout (#3)", () => {
  it("aborts a hung Converse call at LLM_TIMEOUT_MS instead of running forever", async () => {
    h.send = hangingSend;
    const provider = new BedrockProvider({ region: "us-east-1" });
    const outcome = provider.assess(input).then(
      () => "resolved",
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Bedrock request timed out.");
  });

  it("still aborts on client disconnect (the two signals are combined)", async () => {
    h.send = hangingSend;
    const ctrl = new AbortController();
    const provider = new BedrockProvider({ region: "us-east-1" });
    const outcome = provider.assess(input, { signal: ctrl.signal }).then(
      () => "resolved",
      (err: unknown) => err,
    );
    ctrl.abort(new Error("client disconnected"));
    await vi.advanceTimersByTimeAsync(0);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("client disconnected");
  });

  it("extended-thinking reserves the FULL answer budget on top of the thinking budget (#4)", async () => {
    // Old formula `Math.max(baseMaxTokens, thinking + 1024)` left the answer only ~1024 tokens for a
    // large thinking budget → the 9-dimension tool JSON truncated → mock. maxTokens must be
    // thinking + baseMaxTokens so the answer room is guaranteed regardless of the thinking budget.
    vi.stubEnv("LLM_THINKING_BUDGET", "8000");
    vi.stubEnv("BEDROCK_MAX_TOKENS", "4096");
    let captured: Captured | undefined;
    h.send = async (cmd: unknown) => {
      captured = (cmd as { input: Captured }).input;
      return {
        output: { message: { content: [{ toolUse: { input: { dimensions: [{ id: "D1", score: 70 }] } } }] } },
      };
    };
    const provider = new BedrockProvider({ region: "us-east-1" });
    const outcome = provider.assess(input);
    await vi.advanceTimersByTimeAsync(0);
    await outcome;
    expect(captured?.inferenceConfig?.maxTokens).toBe(12_096); // 8000 + 4096, NOT max(4096, 8000+1024)
    // Thinking-on relaxes forced tool choice to auto (forced tool use is incompatible with thinking).
    expect(captured?.toolConfig?.toolChoice).toEqual({ auto: {} });
  });

  it("clears the timer and reports usage on a successful structured answer", async () => {
    h.send = async () => ({
      usage: { inputTokens: 100, outputTokens: 50 },
      output: {
        message: {
          content: [{ toolUse: { input: { dimensions: [{ id: "D1", score: 70 }] } } }],
        },
      },
    });
    const provider = new BedrockProvider({ region: "us-east-1" });
    const onUsage = vi.fn();
    const outcome = provider.assess(input, { onUsage });
    await vi.advanceTimersByTimeAsync(0);
    const a = await outcome;
    expect(a.dimensions[0]).toMatchObject({ id: "D1", score: 70 });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50 });
    expect(vi.getTimerCount()).toBe(0); // the timeout timer was cleared in finally
  });
});

describe("BedrockProvider.assess — empty tool-input object doesn't discard a usable answer (G3-15)", () => {
  it("falls through past an empty {} tool-input block to a LATER block with real dimensions", async () => {
    // Some models/regions can return a forced-tool response whose FIRST toolUse.input is a
    // placeholder {} — short-circuiting there (typeof === "object") threw away a later block (or the
    // text-path safety net) that actually carried the answer.
    h.send = async () => ({
      output: {
        message: {
          content: [
            { toolUse: { input: {} } },
            { toolUse: { input: { dimensions: [{ id: "D1", score: 80 }] } } },
          ],
        },
      },
    });
    const provider = new BedrockProvider({ region: "us-east-1" });
    const outcome = provider.assess(input);
    await vi.advanceTimersByTimeAsync(0);
    const a = await outcome;
    expect(a.dimensions[0]).toMatchObject({ id: "D1", score: 80 });
  });

  it("falls through to the text safety net when every toolUse.input is empty/dimension-less", async () => {
    h.send = async () => ({
      output: {
        message: {
          content: [
            { toolUse: { input: {} } },
            { text: JSON.stringify({ dimensions: [{ id: "D1", score: 55 }] }) },
          ],
        },
      },
    });
    const provider = new BedrockProvider({ region: "us-east-1" });
    const outcome = provider.assess(input);
    await vi.advanceTimersByTimeAsync(0);
    const a = await outcome;
    expect(a.dimensions[0]).toMatchObject({ id: "D1", score: 55 });
  });
});

describe("testBedrockConnection — exercises the forced tool schema, not a bare ping (#6)", () => {
  it("sends the REQUIRED report_assessment toolConfig so tool-capability is actually validated", async () => {
    // A bare `ping` green-checked models/regions that don't support Converse tool use — then every
    // real scan (which forces this toolConfig) errored → silent mock. The test must make the same
    // forced-tool request a real assess() makes, so a passing test proves a passing scan.
    let captured: Captured | undefined;
    h.send = async (cmd: unknown) => {
      captured = (cmd as { input: Captured }).input;
      return { output: { message: { content: [{ toolUse: { input: {} } }] } } };
    };
    const res = await testBedrockConnection({
      model: "us.anthropic.claude-sonnet-4-6",
      region: "us-east-1",
      credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
    });
    expect(res.ok).toBe(true);
    expect(captured?.toolConfig?.tools?.[0]?.toolSpec?.name).toBe(ASSESSMENT_TOOL_NAME);
    expect(captured?.toolConfig?.toolChoice).toEqual({ tool: { name: ASSESSMENT_TOOL_NAME } });
    // Not the old maxTokens:1 — the forced tool-use needs room to emit or it truncates into a failure.
    expect(captured?.inferenceConfig?.maxTokens).toBeGreaterThan(1);
  });

  it("surfaces a sanitized { ok:false, error } when the model rejects the tool schema", async () => {
    // A model/region that can't do Converse tool use now FAILS the test (it used to pass the bare ping).
    h.send = async () => {
      throw new Error("This model does not support tool use with Converse.");
    };
    const res = await testBedrockConnection({ model: "legacy-model", region: "us-east-1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("tool use");
  });
});

// ── THE REGION GRAMMAR (security scan 2026-10-06, F3) ───────────────────────────────────────────
//
// The SDK interpolates the region into `https://bedrock-runtime.{Region}.amazonaws.com`, so an
// unvalidated caller-supplied region picks the host this server signs a SigV4 request to. The refusal
// lives in resolveBedrockRegion — the one function that owns the precedence — so the provider
// constructor and the BYOM test door both inherit it and neither can read the value without it.

describe("the AWS region grammar", () => {
  it("accepts the real region shapes", () => {
    for (const r of ["us-east-1", "us-west-2", "eu-central-1", "ap-southeast-2", "us-gov-west-1", "ca-central-1"]) {
      expect(isValidAwsRegion(r)).toBe(true);
    }
  });

  it("refuses the endpoint-template escapes an owner could type", () => {
    // `example.com/` resolves to https://bedrock-runtime.example.com/.amazonaws.com — an outbound
    // probe to a host the caller chose. `us-east-1/../x` is the same trick wearing a valid prefix.
    for (const r of ["example.com/", "us-east-1/../x", "", "US-EAST-1", "us-east", "us-east-1.", "us_east_1", "us-east-1 "]) {
      expect(isValidAwsRegion(r)).toBe(false);
    }
  });

  it("resolveBedrockRegion throws on a non-conforming EXPLICIT region instead of handing it to the SDK", () => {
    expect(() => resolveBedrockRegion("example.com/")).toThrow("Region must look like us-east-1.");
    expect(() => resolveBedrockRegion("us-east-1/../x")).toThrow("Region must look like us-east-1.");
    expect(() => new BedrockProvider({ region: "example.com/" })).toThrow("Region must look like us-east-1.");
  });

  it("keeps the env fallback precedence — explicit → BEDROCK_REGION → AWS_REGION → default", () => {
    const saved = { b: process.env.BEDROCK_REGION, a: process.env.AWS_REGION };
    try {
      delete process.env.BEDROCK_REGION;
      delete process.env.AWS_REGION;
      expect(resolveBedrockRegion()).toBe(DEFAULT_BEDROCK_REGION);
      process.env.AWS_REGION = "ap-south-1";
      expect(resolveBedrockRegion()).toBe("ap-south-1");
      process.env.BEDROCK_REGION = "eu-west-3";
      expect(resolveBedrockRegion()).toBe("eu-west-3");
      expect(resolveBedrockRegion("us-west-2")).toBe("us-west-2");
    } finally {
      if (saved.b === undefined) delete process.env.BEDROCK_REGION; else process.env.BEDROCK_REGION = saved.b;
      if (saved.a === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = saved.a;
    }
  });

  it("testBedrockConnection answers { ok:false, error } rather than throwing out of its contract", async () => {
    h.send = async () => ({ output: { message: { content: [{ text: "unused" }] } } });
    const res = await testBedrockConnection({ model: "m", region: "example.com/" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Region must look like us-east-1.");
  });
});
