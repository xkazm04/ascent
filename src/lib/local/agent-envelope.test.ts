// A FAILED SESSION'S OWN WORDS. The runner's session-limit breaker classifies `errorText`, and the lane
// log keeps only the summary's FIRST line — so a failure whose words were empty, or began with a blank
// line, used to log "Agent error (success): " and hide "You've hit your session limit" from both.
// (The envelope's measurement table lives in agent.test.ts, unchanged.)

import { describe, expect, it } from "vitest";
import { ERROR_TEXT_MAX, agentErrorText, parseAgentEnvelope } from "@/lib/local/agent-envelope";

const opts = { fallbackModel: "sonnet", exitCode: 1, stderr: "" };
const firstLineOf = (s: string) => s.split("\n")[0];

describe("parseAgentEnvelope — the failure summary carries the CLI's words on its first line", () => {
  it("keeps the subtype and the result text, as before", () => {
    const env = parseAgentEnvelope(JSON.stringify({ is_error: true, subtype: "success", result: "You've hit your session limit · resets 3pm" }), opts);
    expect(env.ok).toBe(false);
    expect(firstLineOf(env.summary)).toBe("Agent error (success): You've hit your session limit · resets 3pm");
  });

  it("drops a leading blank line so the words reach the log's one line", () => {
    const env = parseAgentEnvelope(JSON.stringify({ is_error: true, subtype: "success", result: "\n\nYou've hit your session limit" }), opts);
    expect(firstLineOf(env.summary)).toContain("You've hit your session limit");
  });

  it("falls through an EMPTY result to the errors list, the stream hint, then stderr", () => {
    const empty = { is_error: true, subtype: "error_during_execution", result: "" };
    expect(parseAgentEnvelope(JSON.stringify({ ...empty, errors: ["API Error: 529 overloaded"] }), opts).summary).toContain("529 overloaded");
    expect(parseAgentEnvelope(JSON.stringify(empty), { ...opts, errorHint: "You've hit your session limit" }).summary).toContain(
      "session limit",
    );
    expect(parseAgentEnvelope(JSON.stringify(empty), { ...opts, stderr: "boom on stderr" }).summary).toContain("boom on stderr");
  });

  it("names the hint in the no-envelope sentence when the stream ended without a result", () => {
    const env = parseAgentEnvelope("", { ...opts, errorHint: "You've hit your session limit", stderr: "noise" });
    expect(env.summary).toBe("Agent exited (1) without a JSON envelope: You've hit your session limit");
    // …and today's sentence, byte for byte, when there is none.
    expect(parseAgentEnvelope("", { ...opts, stderr: "" }).summary).toBe("Agent exited (1) without a JSON envelope: (no output)");
  });

  it("leaves a successful envelope untouched", () => {
    const env = parseAgentEnvelope(JSON.stringify({ result: "done", is_error: false }), { ...opts, errorHint: "ignored" });
    expect(env).toMatchObject({ ok: true, summary: "done" });
  });
});

describe("agentErrorText — what the breaker reads", () => {
  it("is the result text of a failed envelope", () => {
    expect(agentErrorText(JSON.stringify({ is_error: true, result: "You've hit your session limit · resets 3pm" }), { stderr: "x" })).toBe(
      "You've hit your session limit · resets 3pm",
    );
  });

  it("is the errors list, then the hint, then stderr, when the result says nothing", () => {
    expect(agentErrorText(JSON.stringify({ is_error: true, errors: ["a", "b"] }), { stderr: "s" })).toBe("a\nb");
    expect(agentErrorText(JSON.stringify({ is_error: true }), { stderr: "s", errorHint: "limit" })).toBe("limit");
    expect(agentErrorText(JSON.stringify({ is_error: true }), { stderr: "  s  " })).toBe("s");
  });

  it("is the raw output for output that never was an envelope, else the hint or stderr", () => {
    expect(agentErrorText("command not found", { stderr: "s" })).toBe("command not found");
    expect(agentErrorText("", { stderr: "stderr words" })).toBe("stderr words");
    expect(agentErrorText("", { stderr: "", errorHint: "hint" })).toBe("hint");
  });

  it("is null when nothing was said anywhere — unknown, not an empty sentence", () => {
    expect(agentErrorText("", { stderr: "" })).toBeNull();
    expect(agentErrorText(JSON.stringify({ is_error: true }), { stderr: "   " })).toBeNull();
  });

  it("is bounded", () => {
    const long = "x".repeat(10_000);
    expect(agentErrorText(JSON.stringify({ is_error: true, result: long }), { stderr: "" })).toHaveLength(ERROR_TEXT_MAX);
  });
});
