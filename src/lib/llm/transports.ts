// The WIRE half of the free-form text seam: one transport per provider protocol, each turning a
// provider-neutral {@link LegRequest} into that provider's request and its reply back into a
// {@link LegResult}. Extracted from text.ts (which keeps provider SELECTION, the timeout lifecycle and
// the metering) so adding tool calling didn't push one module past the structure cap, and so the three
// wire formats sit side by side where a divergence between them is visible.
//
// THE ONE RULE THAT MATTERS HERE: a reply that is nothing but tool calls carries NO text. Every one of
// these transports used to `throw new Error("Empty response…")` on falsy content, which would have made
// the very FIRST tool turn a hard failure on all three. The tool-call field is therefore read BEFORE
// the empty check, and the check now means "no text AND no tool calls" — which is still exactly the
// old behaviour for a toolless call, because `toolCalls` is empty on every one of those.

import type { TokenUsage } from "@/lib/types";
import { llmMaxTokens, llmTemperature } from "@/lib/llm/config";
import type { AthenaTool, LegRequest, LegResult, LegTurn, ToolCall } from "@/lib/llm/leg";
import type { BedrockCredentials } from "@/lib/llm/bedrock";

/**
 * An HTTP failure from an OpenAI-compatible endpoint, carrying the STATUS and BODY alongside the
 * message. The message text is byte-identical to the plain `Error` this used to throw (existing tests
 * and log lines match on it); the extra fields exist so a caller can classify the failure — today
 * {@link isToolCallingRejection} — instead of regexing a rendered string. Mirrors the role
 * `isResponseFormatRejection` (src/lib/llm/schema.ts) plays for strict-JSON rejections.
 */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "LlmHttpError";
  }
}

/**
 * Does this failure look like "I don't implement tool calling"? Self-hosted OpenAI-compatible servers
 * (older vLLM builds, some Ollama models, LM Studio without a tool-capable template) reject the
 * REQUEST with a 4xx naming the field rather than answering without tools. Detecting that lets the tool
 * loop fall back ONCE to a single-shot prompt and SAY SO (`grounding: "prefetched"`), instead of
 * turning a self-hoster's whole Athena surface into a hard error. A genuine auth/quota/model error does
 * not match, so it still surfaces as a real failure. Same shape and same reasoning as
 * `isResponseFormatRejection` (src/lib/llm/schema.ts:185).
 */
export function isToolCallingRejection(err: unknown): boolean {
  if (!(err instanceof LlmHttpError)) return false;
  if (err.status !== 400 && err.status !== 404 && err.status !== 422 && err.status !== 501) return false;
  return /tool[s_ ]?|function[_ ]?call|tool_choice|tool_calls/i.test(err.body);
}

/** Best-effort parse of a tool-call argument blob. A model that emits malformed arguments should reach
 *  the caller's `execute` as an EMPTY arg set (which the tool can reject on its own terms), not blow up
 *  the whole loop with a SyntaxError. */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A tool result as a JSON object, which is what Bedrock's `toolResult.content[].json` expects. The
 *  caller's `execute` returns a string; when that string IS a JSON object we pass it through, otherwise
 *  we wrap it so plain prose is still deliverable. */
function asJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* not JSON — fall through */
  }
  return { result: content };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (serves `openai`, `openrouter` and `local` — one protocol)
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function openAiMessages(req: LegRequest): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: "user", content: req.prompt }];
  for (const turn of req.history ?? []) {
    if (turn.kind === "assistant") {
      messages.push({
        role: "assistant",
        // `null`, not `""` — several OpenAI-compatible servers reject an empty-string assistant content
        // that is accompanied by tool_calls.
        content: turn.text || null,
        ...(turn.calls.length
          ? {
              tool_calls: turn.calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of turn.results) {
        messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
      }
    }
  }
  return messages;
}

function openAiTools(tools: AthenaTool[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/**
 * The ONE OpenAI-compatible transport, shared by the `openai` (incl. Azure / vLLM / Ollama / LM Studio),
 * `openrouter` and `local` selections — they speak the identical /chat/completions API, which is exactly
 * why openrouter.ts and local.ts exist as thin variants of openai.ts. No response_format is requested: a
 * caller here owns its own contract and every one of them repair-parses with parseJsonLoose anyway, so
 * demanding strict JSON would only add a failure mode for endpoints that don't implement it.
 */
export async function openAiCompatibleLeg(args: {
  url: string;
  headers: Record<string, string>;
  model: string;
  label: string;
  maxTokensEnv: string;
  req: LegRequest;
  signal?: AbortSignal;
}): Promise<LegResult> {
  const tools = openAiTools(args.req.tools);
  const res = await fetch(args.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...args.headers },
    body: JSON.stringify({
      model: args.model,
      temperature: llmTemperature(args.req.legKind),
      max_tokens: llmMaxTokens(args.maxTokensEnv),
      messages: openAiMessages(args.req),
      ...(tools ? { tools } : {}),
    }),
    signal: args.signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmHttpError(res.status, body, `${args.label} request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  // Tool calls FIRST — see the module header.
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id || `call_${i}`,
    name: tc.function?.name ?? "",
    args: parseArgs(tc.function?.arguments),
  }));
  const text = message?.content ?? "";
  if (!text && toolCalls.length === 0) throw new Error(`Empty response from ${args.label}.`);
  return {
    text,
    usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/** Gemini correlates a functionResponse to its functionCall by NAME, not by id, so ids are synthesized
 *  on the way out and only used to key the loop's own bookkeeping. */
function geminiContents(req: LegRequest): unknown[] {
  const contents: unknown[] = [{ role: "user", parts: [{ text: req.prompt }] }];
  for (const turn of req.history ?? []) {
    if (turn.kind === "assistant") {
      contents.push({
        role: "model",
        parts: [
          ...(turn.text ? [{ text: turn.text }] : []),
          ...turn.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        ],
      });
    } else {
      contents.push({
        role: "user",
        parts: turn.results.map((r) => ({
          functionResponse: { name: r.name, response: asJsonObject(r.content) },
        })),
      });
    }
  }
  return contents;
}

export async function geminiLeg(
  model: string,
  apiKey: string,
  req: LegRequest,
  signal?: AbortSignal,
): Promise<LegResult> {
  const { GoogleGenAI } = await import("@google/genai");
  const tools = req.tools?.length
    ? [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            // `parametersJsonSchema` (not `parameters`) takes a raw JSON Schema object, which is what
            // callers hand us — the same object Bedrock wraps as `inputSchema.json`.
            parametersJsonSchema: t.inputSchema,
          })),
        },
      ]
    : undefined;
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model,
    // A history-free leg keeps passing the bare prompt string, exactly as before.
    contents: (req.history?.length ? geminiContents(req) : req.prompt) as never,
    config: {
      temperature: llmTemperature(req.legKind),
      abortSignal: signal,
      ...(tools ? { tools } : {}),
    },
  });
  // Tool calls FIRST — see the module header.
  const toolCalls: ToolCall[] = (response.functionCalls ?? []).map((fc, i) => ({
    id: fc.id || `${fc.name ?? "call"}_${i}`,
    name: fc.name ?? "",
    args: parseArgs(fc.args),
  }));
  const text = response.text ?? "";
  if (!text && toolCalls.length === 0) throw new Error("Empty response from Gemini.");
  const um = response.usageMetadata;
  return {
    text,
    usage: { inputTokens: um?.promptTokenCount, outputTokens: um?.candidatesTokenCount },
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Bedrock (Converse)
// ---------------------------------------------------------------------------

function bedrockMessages(req: LegRequest): unknown[] {
  const messages: unknown[] = [{ role: "user", content: [{ text: req.prompt }] }];
  for (const turn of req.history ?? []) {
    if (turn.kind === "assistant") {
      messages.push({
        role: "assistant",
        content: [
          ...(turn.text ? [{ text: turn.text }] : []),
          ...turn.calls.map((c) => ({ toolUse: { toolUseId: c.id, name: c.name, input: c.args } })),
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: turn.results.map((r) => ({
          toolResult: { toolUseId: r.id, content: [{ json: asJsonObject(r.content) }] },
        })),
      });
    }
  }
  return messages;
}

/** The exact `toolConfig` shape BedrockProvider.assess() already uses for schema-constrained scoring
 *  (src/lib/llm/bedrock.ts:128-139) — reused rather than re-derived. `toolChoice` is deliberately
 *  OMITTED (= auto): the scan path forces a single tool because there is exactly one right answer
 *  shape, whereas a loop leg must be free to stop calling tools and just answer. */
function bedrockToolConfig(tools: AthenaTool[] | undefined) {
  if (!tools?.length) return undefined;
  return {
    tools: tools.map((t) => ({
      toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } },
    })),
  };
}

export async function bedrockLeg(
  model: string,
  region: string,
  req: LegRequest,
  signal?: AbortSignal,
  /** BYOM: the org's own AWS credentials. Omitted = the default chain (the platform's account). */
  credentials?: BedrockCredentials,
): Promise<LegResult> {
  // Lazily imported exactly as BedrockProvider does, so the AWS SDK never loads on the other paths.
  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const toolConfig = bedrockToolConfig(req.tools);
  const res = await new BedrockRuntimeClient({ region, ...(credentials ? { credentials } : {}) }).send(
    new ConverseCommand({
      modelId: model,
      messages: bedrockMessages(req) as never,
      inferenceConfig: { temperature: llmTemperature(req.legKind), maxTokens: llmMaxTokens("BEDROCK_MAX_TOKENS") },
      ...(toolConfig ? { toolConfig: toolConfig as never } : {}),
    }),
    { abortSignal: signal },
  );
  const blocks = res.output?.message?.content ?? [];
  // Tool calls FIRST — see the module header.
  const toolCalls: ToolCall[] = blocks
    .map((p) => (p as { toolUse?: { toolUseId?: string; name?: string; input?: unknown } }).toolUse)
    .filter((tu): tu is { toolUseId?: string; name?: string; input?: unknown } => Boolean(tu))
    .map((tu, i) => ({ id: tu.toolUseId || `call_${i}`, name: tu.name ?? "", args: parseArgs(tu.input) }));
  const text = blocks.map((p) => (p as { text?: string }).text ?? "").join("");
  if (!text && toolCalls.length === 0) throw new Error("Empty response from Bedrock.");
  const usage: TokenUsage = {
    inputTokens: res.usage?.inputTokens,
    outputTokens: res.usage?.outputTokens,
    cacheReadTokens: res.usage?.cacheReadInputTokens,
    cacheWriteTokens: res.usage?.cacheWriteInputTokens,
  };
  return { text, usage, toolCalls };
}

export type { LegRequest, LegResult, LegTurn };
