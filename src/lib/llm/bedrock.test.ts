// Regression tests for the Bedrock per-call timeout (biz-bug-scan-2026-06-11, llm finding #3):
// Bedrock was the only provider with no per-call timeout, so one hung Converse call ran until
// scan.ts's 90s total LLM budget expired — structurally starving the retry + failover steps for
// the enterprise path. assess() must CANCEL the call at LLM_TIMEOUT_MS (the W6-2
// AbortController pattern shared with gemini/openai). No live AWS call: the SDK is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BedrockProvider, testBedrockConnection } from "./bedrock";
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
