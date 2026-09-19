// Output normalization for the two agent-CLI envelope dialects (agent-cli-transport subject:
// output-normalization). Fixture strings captured from live runs on 2026-08-25 (claude 2.1.245,
// codex-cli 0.139.0) — no live spawn in this suite.

import { describe, expect, it } from "vitest";
import { unwrapCliEnvelope } from "./claude";
import { parseCodexJsonl } from "./codex";

// ---------------------------------------------------------------------------
// claude: single-JSON-object dialect — answer in `.result`, error state INSIDE the envelope
// ---------------------------------------------------------------------------

describe("unwrapCliEnvelope (claude single-JSON dialect)", () => {
  const success = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"overall": 71}',
    session_id: "abc",
    num_turns: 1,
    duration_ms: 4200,
    usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 },
  });

  it("returns the envelope with the answer in .result and usage intact", () => {
    const env = unwrapCliEnvelope(success);
    expect(env.result).toBe('{"overall": 71}');
    expect(env.usage?.input_tokens).toBe(1200);
    expect(env.usage?.cache_read_input_tokens).toBe(800);
  });

  it("treats envelope error state as authoritative and surfaces the tool's own subtype", () => {
    const raw = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "Hit the turn limit." });
    expect(() => unwrapCliEnvelope(raw)).toThrow(/error_max_turns/);
    expect(() => unwrapCliEnvelope(raw)).toThrow(/Hit the turn limit\./);
  });

  it("never reports a missing/non-string result as success", () => {
    const raw = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: 42 });
    expect(() => unwrapCliEnvelope(raw)).toThrow(/returned an error/);
  });

  // The raw text IS the diagnosis: a "/login" prompt, rate-limit text and a missing-binary message
  // each read completely differently — collapsing them into one opaque error converts every one of
  // them into "model unavailable, deterministic scores".
  it("preserves a bounded prefix of unparseable stdout in the error", () => {
    expect(() => unwrapCliEnvelope("Please run /login to authenticate.")).toThrow(
      /did not return a JSON envelope: Please run \/login/,
    );
  });

  it("names empty stdout rather than throwing a bare SyntaxError", () => {
    expect(() => unwrapCliEnvelope("")).toThrow(/\(empty stdout\)/);
  });
});

// ---------------------------------------------------------------------------
// codex: JSONL event-stream dialect — answer is the LAST completed agent_message's text
// ---------------------------------------------------------------------------

describe("parseCodexJsonl (codex JSONL dialect)", () => {
  // Captured live 2026-08-25 (codex exec --json, codex-cli 0.139.0).
  const happy = [
    '{"type":"thread.started","thread_id":"th_123"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0}}',
  ].join("\n");

  it("extracts the agent_message text and the turn usage", () => {
    const parsed = parseCodexJsonl(happy);
    expect(parsed.text).toBe("OK");
    expect(parsed.usage).toEqual({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 });
    expect(parsed.errorMessage).toBeUndefined();
  });

  it("folds the stream: the LAST completed agent_message wins, never the first parseable line", () => {
    const raw = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"draft answer"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"thinking..."}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"final answer"}}',
    ].join("\n");
    expect(parseCodexJsonl(raw).text).toBe("final answer");
  });

  it("skips non-JSON noise lines without poisoning the parse", () => {
    const raw = [
      "ERROR codex_models_manager::cache: failed to load models cache: missing field `foo`",
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}',
    ].join("\n");
    expect(parseCodexJsonl(raw).text).toBe("OK");
  });

  it("ignores completed items that are not agent messages", () => {
    const raw = '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","text":"ls"}}';
    expect(parseCodexJsonl(raw).text).toBeUndefined();
  });

  it("surfaces the stream's own error report", () => {
    const raw = '{"type":"turn.failed","error":{"message":"usage limit reached"}}';
    expect(parseCodexJsonl(raw).errorMessage).toBe("usage limit reached");
  });

  it("handles CRLF line endings (Windows shells)", () => {
    const raw = '{"type":"turn.started"}\r\n{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\r\n';
    expect(parseCodexJsonl(raw).text).toBe("OK");
  });
});
