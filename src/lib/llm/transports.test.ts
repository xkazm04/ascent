// The wire half of the text seam. What is guarded here is the trap that would have made the very
// FIRST tool turn a hard failure on every provider: all three transports used to throw
// "Empty response from X" on falsy content, and a reply that is nothing but tool calls HAS no content.
// One test per transport, plus the classifier that drives the honest single-shot degrade.

import { describe, it, expect, vi, afterEach } from "vitest";
import { bedrockLeg, geminiLeg, openAiCompatibleLeg, isToolCallingRejection, LlmHttpError } from "@/lib/llm/transports";
import type { LegRequest } from "@/lib/llm/leg";

const TOOL = { name: "org_repos", description: "List repos", inputSchema: { type: "object" } };
const ask = (extra: Partial<LegRequest> = {}): LegRequest => ({
  prompt: "which repos are failing?",
  legKind: "athena_turn",
  tools: [TOOL],
  ...extra,
});

// --- Bedrock -----------------------------------------------------------------------------------

/** Stand in for @aws-sdk/client-bedrock-runtime. `sent` collects every ConverseCommand input so the
 *  request SHAPE (toolConfig, toolResult blocks) can be asserted without a network call. */
const sent: Record<string, unknown>[] = [];
let bedrockReplies: unknown[] = [];
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  ConverseCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  BedrockRuntimeClient: class {
    async send(cmd: { input: Record<string, unknown> }) {
      sent.push(cmd.input);
      return bedrockReplies.shift() ?? { output: { message: { content: [{ text: "fallback" }] } } };
    }
  },
}));

// --- Gemini ------------------------------------------------------------------------------------

let geminiReply: unknown = null;
const geminiRequests: Record<string, unknown>[] = [];
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (req: Record<string, unknown>) => {
        geminiRequests.push(req);
        return geminiReply;
      },
    };
  },
}));

afterEach(() => {
  sent.length = 0;
  geminiRequests.length = 0;
  bedrockReplies = [];
  vi.unstubAllGlobals();
});

describe("a tool-call-only reply is a VALID reply, not an empty response", () => {
  it("bedrock: reads toolUse before the empty check", async () => {
    bedrockReplies = [
      {
        output: { message: { content: [{ toolUse: { toolUseId: "tu_1", name: "org_repos", input: { limit: 5 } } }] } },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    ];
    const res = await bedrockLeg("anthropic.claude-sonnet-4-6", "us-east-1", ask());
    expect(res.text).toBe("");
    expect(res.toolCalls).toEqual([{ id: "tu_1", name: "org_repos", args: { limit: 5 } }]);
    // The toolConfig shape is the one BedrockProvider.assess already ships, reused rather than re-derived.
    expect(sent[0]).toMatchObject({
      toolConfig: { tools: [{ toolSpec: { name: "org_repos", inputSchema: { json: { type: "object" } } } }] },
    });
    // No forced toolChoice: a loop leg must be free to stop calling tools and just answer.
    expect((sent[0] as { toolConfig: Record<string, unknown> }).toolConfig).not.toHaveProperty("toolChoice");
  });

  it("gemini: reads functionCalls before the empty check", async () => {
    geminiReply = { text: "", functionCalls: [{ name: "org_repos", args: { limit: 5 } }] };
    const res = await geminiLeg("gemini-3.7-flash", "k", ask());
    expect(res.text).toBe("");
    expect(res.toolCalls?.[0]).toMatchObject({ name: "org_repos", args: { limit: 5 } });
    expect(geminiRequests[0]).toMatchObject({
      config: { tools: [{ functionDeclarations: [{ name: "org_repos", parametersJsonSchema: { type: "object" } }] }] },
    });
  });

  it("openai-compatible: reads tool_calls before the empty check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "call_a", function: { name: "org_repos", arguments: '{"limit":5}' } }],
              },
            },
          ],
        }),
      ),
    );
    const res = await openAiCompatibleLeg({
      url: "http://x/chat/completions",
      headers: {},
      model: "gpt-4o-mini",
      label: "OpenAI",
      maxTokensEnv: "OPENAI_MAX_TOKENS",
      req: ask(),
    });
    expect(res.text).toBe("");
    expect(res.toolCalls).toEqual([{ id: "call_a", name: "org_repos", args: { limit: 5 } }]);
  });
});

describe("a reply with neither text nor tool calls is still an error", () => {
  it("bedrock", async () => {
    bedrockReplies = [{ output: { message: { content: [] } } }];
    await expect(bedrockLeg("m", "us-east-1", ask())).rejects.toThrow(/Empty response from Bedrock/);
  });
  it("gemini", async () => {
    geminiReply = { text: "" };
    await expect(geminiLeg("m", "k", ask())).rejects.toThrow(/Empty response from Gemini/);
  });
  it("openai-compatible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "" } }] })));
    await expect(
      openAiCompatibleLeg({
        url: "http://x/chat/completions",
        headers: {},
        model: "m",
        label: "OpenAI",
        maxTokensEnv: "OPENAI_MAX_TOKENS",
        req: ask({ tools: undefined }),
      }),
    ).rejects.toThrow(/Empty response from OpenAI/);
  });
});

describe("tool results travel back in each provider's own envelope", () => {
  const history: LegRequest["history"] = [
    { kind: "assistant", text: "", calls: [{ id: "tu_1", name: "org_repos", args: {} }] },
    { kind: "toolResults", results: [{ id: "tu_1", name: "org_repos", content: '{"repos":2}' }] },
  ];

  it("bedrock sends a toolResult block keyed by toolUseId", async () => {
    bedrockReplies = [{ output: { message: { content: [{ text: "two repos" }] } } }];
    const res = await bedrockLeg("m", "us-east-1", ask({ history }));
    expect(res.text).toBe("two repos");
    const messages = (sent[0] as { messages: Record<string, unknown>[] }).messages;
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ toolResult: { toolUseId: "tu_1", content: [{ json: { repos: 2 } }] } }],
    });
  });

  it("gemini sends a functionResponse keyed by NAME (it has no call ids)", async () => {
    geminiReply = { text: "two repos" };
    await geminiLeg("m", "k", ask({ history }));
    const contents = (geminiRequests[0] as { contents: Record<string, unknown>[] }).contents;
    expect(contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "org_repos", response: { repos: 2 } } }],
    });
  });

  it("openai-compatible sends a role:tool message keyed by tool_call_id", async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "two repos" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await openAiCompatibleLeg({
      url: "http://x/chat/completions",
      headers: {},
      model: "m",
      label: "OpenAI",
      maxTokensEnv: "OPENAI_MAX_TOKENS",
      req: ask({ history }),
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "tu_1", content: '{"repos":2}' });
    // An empty-string assistant content alongside tool_calls is rejected by several servers.
    expect(body.messages[1].content).toBeNull();
  });
});

describe("isToolCallingRejection", () => {
  it("matches a 4xx that names the tools field", () => {
    expect(isToolCallingRejection(new LlmHttpError(400, '{"error":"tools is not supported"}', "x"))).toBe(true);
    expect(isToolCallingRejection(new LlmHttpError(404, "function_call unsupported", "x"))).toBe(true);
  });
  it("does NOT match a genuine auth/quota failure — that must still surface", () => {
    expect(isToolCallingRejection(new LlmHttpError(401, "invalid api key", "x"))).toBe(false);
    expect(isToolCallingRejection(new LlmHttpError(429, "rate limited", "x"))).toBe(false);
    expect(isToolCallingRejection(new LlmHttpError(500, "tools exploded", "x"))).toBe(false);
    expect(isToolCallingRejection(new Error("tools"))).toBe(false);
  });
});
