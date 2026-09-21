// THE STREAM PARSER against a REAL session. `__fixtures__/claude-stream-2.1.276.jsonl` is one
// `claude -p --output-format stream-json --verbose --model haiku` call (CLI 2.1.276, 2026-09-18), trimmed:
// the init event's tool/skill/plugin lists shortened, the thinking signatures and the tool_result body cut,
// the worktree path replaced by `C:\work\acme-api`. Every event TYPE it carried is kept — hook traces and
// a `rate_limit_event` included, because an unknown type the parser must ignore is exactly what they are.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStreamParser, firstLine, repoPath, toolEvent } from "@/lib/local/agent-stream";
import { parseAgentEnvelope } from "@/lib/local/agent-envelope";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

const FIXTURE = readFileSync(join(__dirname, "__fixtures__", "claude-stream-2.1.276.jsonl"), "utf8");
const CWD = "C:\\work\\acme-api";
const RESULT_LINE = FIXTURE.split("\n").find((l) => l.includes('"type":"result"'))!;

function feed(text: string, chunk: number, cwd = CWD) {
  const events: AgentStreamEvent[] = [];
  const p = createStreamParser((e) => events.push(e), { cwd });
  for (let i = 0; i < text.length; i += chunk) p.push(text.slice(i, i + chunk));
  const result = p.end();
  return { events, result, raw: p.raw(), hint: p.errorHint() };
}

describe("the recorded 2.1.276 session", () => {
  it("yields the Read (repo-relative), the answer text and the result — and ignores everything else", () => {
    const { events } = feed(FIXTURE, FIXTURE.length);
    expect(events).toEqual([
      { kind: "read", path: "package.json", tool: "Read", note: null },
      { kind: "text", path: null, tool: null, note: "ascent" },
      { kind: "result", path: null, tool: null, note: null, turns: 2, costMicros: 4_617_150 },
    ]);
  });

  it("is chunk-boundary proof — any cut, down to one character at a time, parses the same", () => {
    const whole = feed(FIXTURE, FIXTURE.length);
    for (const size of [1, 7, 64, 1_000]) {
      const cut = feed(FIXTURE, size);
      expect(cut.events).toEqual(whole.events);
      expect(cut.result).toBe(whole.result);
    }
  });

  it("hands back the result line, and the envelope read from it is the one-shot envelope, field for field", () => {
    const { result, raw } = feed(FIXTURE, 512);
    expect(result).toBe(RESULT_LINE.trim());
    // A stream drops the verbatim copy the moment it proves to be one: memory is the result line only.
    expect(raw).toBe("");
    const opts = { fallbackModel: "haiku", exitCode: 0, stderr: "" };
    const streamed = parseAgentEnvelope(result!, opts);
    expect(streamed).toEqual(parseAgentEnvelope(RESULT_LINE, opts));
    expect(streamed).toMatchObject({
      ok: true,
      summary: "ascent",
      model: "claude-haiku-4-5-20251001",
      turns: 2,
      durationMs: 10_277,
      sessionId: "9784dbcf-260f-4a19-af0a-e4a9f030d5c1",
    });
  });
});

describe("tolerance", () => {
  it("parses a ONE-SHOT json object exactly as before — an older CLI, or a test double", () => {
    const oneShot = JSON.stringify({ result: "did the thing", total_cost_usd: 0.01 });
    const { events, result, raw } = feed(oneShot, 5);
    expect(events).toEqual([]);
    expect(result).toBeNull();
    expect(raw).toBe(oneShot);
  });

  it("keeps a pretty-printed envelope verbatim, so the fallback parse still reads it", () => {
    const pretty = JSON.stringify({ type: "result", result: "ok", num_turns: 1 }, null, 2);
    const { result, raw } = feed(pretty, 3);
    expect(result).toBeNull();
    expect(parseAgentEnvelope(raw, { fallbackModel: "sonnet", exitCode: 0, stderr: "" }).summary).toBe("ok");
  });

  it("keeps non-JSON output verbatim for the no-envelope sentence", () => {
    expect(feed("command not found\n", 4).raw).toBe("command not found\n");
  });

  it("skips malformed lines and unknown types, and still finds the result", () => {
    const text = ['{"type":"system","subtype":"init"}', "{not json", '{"type":"brand_new_event","x":1}', "plain text", RESULT_LINE].join("\n");
    const { events, result } = feed(text, 9);
    expect(events.map((e) => e.kind)).toEqual(["result"]);
    expect(result).toBe(RESULT_LINE.trim());
  });

  it("returns no result for a stream that never produced one — the caller's no-JSON fallback", () => {
    const { result, raw } = feed('{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[]}}\n', 10);
    expect(result).toBeNull();
    expect(raw).toBe("");
  });

  it("parses a final line that has no trailing newline", () => {
    expect(feed(RESULT_LINE.trim(), 50).result).toBe(RESULT_LINE.trim());
  });

  it("swallows a sink that throws — the session never sees it", () => {
    const p = createStreamParser(() => {
      throw new Error("sink broke");
    });
    expect(() => p.push(FIXTURE)).not.toThrow();
    expect(p.end()).toBe(RESULT_LINE.trim());
  });

  it("SKIPS a frame over the cap whole, never clips it, and resynchronizes at the next line", () => {
    const events: AgentStreamEvent[] = [];
    const p = createStreamParser((e) => events.push(e), { maxFrameChars: 200 });
    const big = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(500) }] } });
    const read = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] } });
    for (let i = 0; i < big.length; i += 37) p.push(big.slice(i, i + 37));
    p.push(`\n${read}\n`);
    p.end();
    expect(events).toEqual([{ kind: "read", path: "a.ts", tool: "Read", note: null }]);
  });

  it("carries the CLI's own error words from a synthetic assistant message", () => {
    const limit = JSON.stringify({
      type: "assistant",
      message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 3pm" }] },
    });
    const { hint, events } = feed(`${limit}\n`, 11);
    expect(hint).toBe("You've hit your session limit · resets 3pm");
    expect(events[0]).toMatchObject({ kind: "text", note: "You've hit your session limit · resets 3pm" });
    // Ordinary agent text is the agent talking, not the CLI.
    const agent = JSON.stringify({ type: "assistant", message: { model: "claude-x", content: [{ type: "text", text: "hi" }] } });
    expect(feed(`${agent}\n`, 5).hint).toBeNull();
  });

  it("notes a failed result's first line", () => {
    const failed = JSON.stringify({ type: "result", is_error: true, subtype: "success", result: "\nYou've hit your limit\nmore" });
    expect(feed(failed, 8).events[0]).toMatchObject({ kind: "result", note: "You've hit your limit" });
  });
});

describe("the tool map", () => {
  const rows: [string, Record<string, unknown>, Partial<AgentStreamEvent>][] = [
    ["Read", { file_path: "C:\\work\\acme-api\\src\\a.ts" }, { kind: "read", path: "src/a.ts" }],
    ["NotebookRead", { notebook_path: "C:/work/acme-api/n.ipynb" }, { kind: "read", path: "n.ipynb" }],
    ["Grep", { pattern: "TODO", path: "C:\\work\\acme-api\\src" }, { kind: "search", path: "src", note: "TODO" }],
    ["Glob", { pattern: "**/*.ts" }, { kind: "search", path: null, note: "**/*.ts" }],
    ["Edit", { file_path: "c:\\WORK\\acme-api\\src\\b.ts" }, { kind: "edit", path: "src/b.ts" }],
    ["MultiEdit", { file_path: "src/c.ts" }, { kind: "edit", path: "src/c.ts" }],
    ["NotebookEdit", { notebook_path: "./n.ipynb" }, { kind: "edit", path: "n.ipynb" }],
    ["Write", { file_path: "C:\\work\\acme-api\\new.ts" }, { kind: "write", path: "new.ts" }],
    ["Bash", { command: "npm test -- --secret=x", description: "Run the unit tests" }, { kind: "tool", tool: "Bash", note: "Run the unit tests", path: null }],
    ["mcp__x__y", {}, { kind: "tool", tool: "mcp__x__y", note: null }],
  ];
  it.each(rows)("%s", (name, inp, want) => {
    expect(toolEvent(name, inp, CWD)).toMatchObject(want);
  });

  it("leaves a path outside the repo as given, with forward slashes, and the repo root as no path", () => {
    expect(repoPath("D:\\elsewhere\\x.ts", CWD)).toBe("D:/elsewhere/x.ts");
    expect(repoPath("C:\\work\\acme-api", CWD)).toBeNull();
    expect(repoPath("/srv/repo/src/a.ts", "/srv/repo")).toBe("src/a.ts");
    // POSIX paths are case-sensitive: no folding off a drive letter.
    expect(repoPath("/SRV/repo/a.ts", "/srv/repo")).toBe("/SRV/repo/a.ts");
  });

  it("takes the first non-empty line, bounded", () => {
    expect(firstLine("\n\n  hello  \nworld")).toBe("hello");
    expect(firstLine("x".repeat(500))).toHaveLength(160);
    expect(firstLine("   ")).toBeNull();
  });
});
