// ClaudeCliProvider.assess constrains its answer to the same ASSESSMENT_JSON_SCHEMA the hosted
// providers send (backlog develop-2026-09-17 row 44). The schema reaches the CLI over stdin (the
// stream-json `initialize` control request; see transport/schema-wire.claude.test.ts for the
// transport half), the validated assessment is built from the result event's `structured_output`,
// and the usage the metering columns read still arrives.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmScoreInput } from "@/lib/llm/provider";
import { ASSESSMENT_JSON_SCHEMA } from "@/lib/llm/schema";

const h = vi.hoisted(() => ({ spawn: vi.fn(), stdin: [] as string[] }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));
vi.mock("@/lib/scoring/prompt", () => ({ buildAssessmentPrompt: () => ({ system: "SYSTEM", user: "USER" }) }));

import { ClaudeCliProvider, runClaudePrompt } from "./claude-cli";

const INPUT = {} as unknown as LlmScoreInput; // buildAssessmentPrompt is mocked — never read
const ASSESSMENT = { headline: "Solid repo", dimensions: [], strengths: ["tests"], risks: [], roadmap: [] };
const usage = { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 };

function fakeChild(stdout: string) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { write: (s: string) => h.stdin.push(s), end: () => {}, destroyed: false }),
    kill: () => {},
  });
  queueMicrotask(() => {
    child.stdout.emit("data", stdout);
    child.emit("close", 0);
  });
  return child;
}

function resultStream(result: Record<string, unknown>): string {
  return [{ type: "system", subtype: "init" }, { type: "result", subtype: "success", is_error: false, usage, ...result }]
    .map((e) => JSON.stringify(e))
    .join("\n");
}

afterEach(() => {
  h.spawn.mockReset();
  h.stdin = [];
});

describe("ClaudeCliProvider.assess (schema-constrained)", () => {
  it("sends ASSESSMENT_JSON_SCHEMA over stdin, never argv", async () => {
    h.spawn.mockImplementation(() => fakeChild(resultStream({ result: JSON.stringify(ASSESSMENT), structured_output: ASSESSMENT })));
    await new ClaudeCliProvider("sonnet").assess(INPUT);
    const [init, user] = h.stdin.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(init.request.jsonSchema).toEqual(ASSESSMENT_JSON_SCHEMA);
    expect(user.message.content).toBe("SYSTEM\n\nUSER");
    expect((h.spawn.mock.calls[0][1] as string[]).join(" ")).not.toContain("headline");
  });

  it("validates the structured_output and reports usage", async () => {
    // The prose `result` is deliberately unparseable: the structured answer is the one read.
    h.spawn.mockImplementation(() => fakeChild(resultStream({ result: "Here you go.", structured_output: ASSESSMENT })));
    const onUsage = vi.fn();
    const out = await new ClaudeCliProvider("sonnet").assess(INPUT, { onUsage });
    expect(out.headline).toBe("Solid repo");
    expect(out.strengths).toEqual(["tests"]);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 1200, outputTokens: 340, cacheReadTokens: 800, cacheWriteTokens: 50 });
  });

  it("guard: an older CLI that ignores the schema still yields an assessment parsed from the text", async () => {
    h.spawn.mockImplementation(() => fakeChild(resultStream({ result: "```json\n" + JSON.stringify(ASSESSMENT) + "\n```" })));
    const out = await new ClaudeCliProvider("sonnet").assess(INPUT);
    expect(out.headline).toBe("Solid repo");
  });

  it("guard: runClaudePrompt stays schema-free on the single-json envelope", async () => {
    h.spawn.mockImplementation(() => fakeChild(JSON.stringify({ is_error: false, result: "a judgment" })));
    await expect(runClaudePrompt("judge this")).resolves.toBe("a judgment");
    expect(h.spawn.mock.calls[0][1]).toEqual(["-p", "--output-format", "json", "--model", expect.any(String)]);
    expect(h.stdin.join("")).toBe("judge this");
  });
});
