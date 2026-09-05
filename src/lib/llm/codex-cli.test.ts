// CodexCliProvider — the assessment seam over the codex transport adapter. These tests pin the
// three contracts the provider owns (the transport's own spawn/parse mechanics are pinned in
// transport/normalize.test.ts and env-strip.test.ts, so the transport is mocked here):
//   1. the "codex-default" sentinel is a DISPLAY identity, never passed to `codex -m`;
//   2. usage reports input/output ONLY (cached_input_tokens semantics are unpinned — an unreported
//      field means "unknown", never a guessed number in the cost fold);
//   3. transport failures rethrow as diagnosable errors, envelope messages intact.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmScoreInput } from "@/lib/llm/provider";

const h = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/llm/transport/codex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/transport/codex")>();
  return { ...actual, codexCliTransport: { ...actual.codexCliTransport, run: h.run } };
});
// The prompt builder needs a full scoring input; its content is irrelevant to this seam.
vi.mock("@/lib/scoring/prompt", () => ({
  buildAssessmentPrompt: () => ({ system: "SYSTEM", user: "USER" }),
}));

import { CodexCliProvider, DEFAULT_CODEX_MODEL } from "./codex-cli";

const INPUT = {} as unknown as LlmScoreInput; // buildAssessmentPrompt is mocked — never read

const ANSWER = JSON.stringify({ headline: "Solid repo", dimensions: [] });
/** A realistic `codex exec --json` capture: agent_message answer + turn.completed usage. */
const RAW_JSONL = [
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ANSWER } }),
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 340 },
  }),
].join("\n");

afterEach(() => {
  vi.unstubAllEnvs();
  h.run.mockReset();
});

describe("CodexCliProvider.assess", () => {
  it("parses the transport's text answer and reports input/output usage ONLY (no guessed cache mapping)", async () => {
    h.run.mockResolvedValue({ ok: true, text: ANSWER, raw: RAW_JSONL, durationMs: 5 });
    const onUsage = vi.fn();
    const result = await new CodexCliProvider("gpt-5-codex").assess(INPUT, { onUsage });
    expect(result.headline).toBe("Solid repo");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1200, outputTokens: 340 });
  });

  it("omits the -m flag under the codex-default sentinel (the CLI's own default model is not an id)", async () => {
    vi.stubEnv("CODEX_MODEL", "");
    h.run.mockResolvedValue({ ok: true, text: ANSWER, raw: "", durationMs: 5 });
    const provider = new CodexCliProvider();
    expect(provider.model).toBe(DEFAULT_CODEX_MODEL);
    await provider.assess(INPUT);
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ mode: "generate", model: undefined }));
  });

  it("passes a real CODEX_MODEL through to the transport", async () => {
    vi.stubEnv("CODEX_MODEL", "gpt-5-codex");
    h.run.mockResolvedValue({ ok: true, text: ANSWER, raw: "", durationMs: 5 });
    const provider = new CodexCliProvider();
    expect(provider.model).toBe("gpt-5-codex");
    await provider.assess(INPUT);
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-codex" }));
  });

  it("rethrows an envelope failure with the transport's diagnosable message", async () => {
    h.run.mockResolvedValue({
      ok: false,
      raw: "",
      durationMs: 5,
      error: { kind: "envelope", message: "Codex CLI produced no agent_message in its JSONL output: (empty stdout)" },
    });
    await expect(new CodexCliProvider("gpt-5-codex").assess(INPUT)).rejects.toThrow(/no agent_message/i);
  });

  it("rethrows a spawn failure's original cause (ENOENT and friends stay diagnosable)", async () => {
    const cause = new Error("spawn codex ENOENT");
    h.run.mockResolvedValue({ ok: false, raw: "", durationMs: 5, error: { kind: "spawn", message: "boom", cause } });
    await expect(new CodexCliProvider("gpt-5-codex").assess(INPUT)).rejects.toBe(cause);
  });
});
