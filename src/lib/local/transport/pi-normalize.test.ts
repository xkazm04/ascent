// THE PI NORMALIZER against TWO REAL SESSIONS.
//
// `__fixtures__/pi-0.86.1-edit.jsonl` is one `pi -p --mode json --model ascent-local/qwen3.8:27b
// -t read,bash,edit,write --thinking off` call (pi 0.86.1 against Ollama 0.32.15 / qwen3.8:27b,
// 2026-09-21), trimmed: the system message's preamble shortened and its rules/docs sections replaced
// by an ellipsis, all but four of the 204 `message_update` delta lines dropped, the `agent_end`
// message array and the edit tool's diff cut, and the worktree path replaced by `C:\work\acme-api`.
// Every event TYPE the session carried is kept.
//
// `__fixtures__/pi-0.86.1-connect-error.jsonl` is the SAME binary pointed at a dead endpoint, trimmed
// the same way. It exists because an envelope that documents a success shape does not document its
// failure shape — and Pi's failure shape is genuinely surprising: it retries three times and EXITS 0.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPiParser, normalizePiStream, piToolEvent } from "@/lib/local/transport/pi-normalize";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

const FIXTURES = join(__dirname, "..", "__fixtures__");
const EDIT = readFileSync(join(FIXTURES, "pi-0.86.1-edit.jsonl"), "utf8");
const FAIL = readFileSync(join(FIXTURES, "pi-0.86.1-connect-error.jsonl"), "utf8");
const CWD = "C:\\work\\acme-api";

const opts = { cwd: CWD, fallbackModel: "qwen3.8:27b", exitCode: 0, stderr: "" };

describe("the recorded 0.86.1 editing session", () => {
  it("yields one event per tool call, in order, with Pi's own tool names", () => {
    const { events } = normalizePiStream(EDIT, opts);
    const tools = events.filter((e) => e.kind !== "text");
    expect(tools).toEqual<AgentStreamEvent[]>([
      { kind: "read", path: "README.md", tool: "read", note: null },
      { kind: "edit", path: "README.md", tool: "edit", note: null },
      { kind: "write", path: "notes.txt", tool: "write", note: null },
      { kind: "tool", path: null, tool: "bash", note: null },
    ]);
  });

  it("yields the answer as a text event — Pi has no `result` field, the last assistant message IS it", () => {
    const { events, envelope } = normalizePiStream(EDIT, opts);
    const text = events.filter((e) => e.kind === "text");
    expect(text.length).toBeGreaterThan(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.summary).toContain("README.md");
    // The note on the last text event is the first line of the same answer.
    expect(envelope.summary.startsWith(text[text.length - 1]!.note!)).toBe(true);
  });

  it("SUMS the per-message usage rather than reading the last one", () => {
    const { envelope } = normalizePiStream(EDIT, opts);
    // The four assistant messages reported 1746+1874+2048+2147 in and 111+54+116+107 out on this
    // session. Reading only the final message would have reported 2147/107 — one turn's worth.
    expect(envelope.inputTokens).toBe(7815);
    expect(envelope.outputTokens).toBe(388);
    expect(envelope.inputTokens).not.toBe(2147);
  });

  it("records turns, session id and model from the stream", () => {
    const { envelope } = normalizePiStream(EDIT, opts);
    expect(envelope.turns).toBe(4);
    expect(envelope.sessionId).toMatch(/^[0-9a-f]{8}-/);
    expect(envelope.model).toBe("qwen3.8:27b");
  });

  it("NEVER banks Pi's zero cost — it is a price list, not a measurement", () => {
    const { envelope } = normalizePiStream(EDIT, opts);
    expect(envelope.costMicros).toBeNull();
  });

  it("derives a duration from the message timestamps when the caller measured none", () => {
    const { envelope } = normalizePiStream(EDIT, opts);
    expect(envelope.durationMs).toBe(7983);
  });

  it("prefers the caller's measured wall clock over the derived span", () => {
    const { envelope } = normalizePiStream(EDIT, { ...opts, durationMs: 13_902 });
    expect(envelope.durationMs).toBe(13_902);
  });

  it("parses identically however the chunks are split", () => {
    for (const size of [1, 7, 64, 4_096]) {
      const events: AgentStreamEvent[] = [];
      const p = createPiParser((e) => events.push(e), { cwd: CWD });
      for (let i = 0; i < EDIT.length; i += size) p.push(EDIT.slice(i, i + size));
      p.end();
      const env = p.envelope(opts);
      expect(env.ok).toBe(true);
      expect(env.inputTokens).toBe(7815);
      expect(events.filter((e) => e.kind !== "text")).toHaveLength(4);
    }
  });
});

describe("the recorded connection failure — Pi's OWN error shape, not Claude's", () => {
  it("is a failure even though the process exited 0", () => {
    const { envelope } = normalizePiStream(FAIL, opts);
    expect(envelope.ok).toBe(false);
    expect(envelope.summary).toContain("Connection error.");
  });

  it("carries the error words for the breaker to classify", () => {
    const { errorText } = normalizePiStream(FAIL, opts);
    expect(errorText).toBe("Connection error.");
  });

  it("still reports what it measured — a failed session's accounting is not blanked", () => {
    const { envelope } = normalizePiStream(FAIL, opts);
    expect(envelope.sessionId).toMatch(/^[0-9a-f]{8}-/);
    expect(envelope.turns).toBe(4);
    expect(envelope.costMicros).toBeNull();
  });
});

describe("output that was never a Pi stream", () => {
  it("reports the exit code and stderr — the unknown-provider shape (exit 1, empty stdout)", () => {
    const { envelope } = normalizePiStream("", {
      ...opts,
      exitCode: 1,
      stderr: 'Error: Unknown provider "ascent-local". Use --list-models to see available providers/models.',
    });
    expect(envelope.ok).toBe(false);
    expect(envelope.summary).toContain("Pi exited (1) without an event stream");
    expect(envelope.summary).toContain("Unknown provider");
    expect(envelope.turns).toBeNull();
    expect(envelope.inputTokens).toBeNull();
  });

  it("says so when nothing was written anywhere", () => {
    const { envelope } = normalizePiStream("", { ...opts, exitCode: 127 });
    expect(envelope.summary).toBe("Pi exited (127) without an event stream: (no output)");
  });

  it("falls back to the requested model rather than inventing one", () => {
    const { envelope } = normalizePiStream("", { ...opts, exitCode: 1 });
    expect(envelope.model).toBe("qwen3.8:27b");
  });
});

describe("tolerance — a malformed stream never becomes an exception", () => {
  it("skips a malformed line and keeps the rest", () => {
    const lines = EDIT.split("\n");
    const broken = [lines[0], "{not json", "", "plain text", ...lines.slice(1)].join("\n");
    const { envelope } = normalizePiStream(broken, opts);
    expect(envelope.ok).toBe(true);
    expect(envelope.turns).toBe(4);
  });

  it("skips an over-long frame whole and resynchronizes at the next newline", () => {
    const lines = EDIT.split("\n").filter(Boolean);
    const huge = `{"type":"noise","pad":"${"x".repeat(5_000)}"}`;
    const { envelope } = normalizePiStream([lines[0], huge, ...lines.slice(1)].join("\n"), {
      ...opts,
      maxFrameChars: 2_000,
    });
    // Every real line is under the cap, so only the noise is lost.
    expect(envelope.ok).toBe(true);
    expect(envelope.turns).toBe(4);
  });

  it("swallows a sink that throws — telemetry never ends the session", () => {
    const p = createPiParser(() => {
      throw new Error("sink exploded");
    }, { cwd: CWD });
    expect(() => {
      p.push(EDIT);
      p.end();
    }).not.toThrow();
    expect(p.envelope(opts).ok).toBe(true);
  });
});

describe("piToolEvent", () => {
  it("maps Pi's four built-ins onto the lane's vocabulary, keeping Pi's spelling", () => {
    expect(piToolEvent("read", { path: "src/a.ts" }, CWD)).toEqual({ kind: "read", path: "src/a.ts", tool: "read", note: null });
    expect(piToolEvent("edit", { path: "src/a.ts" }, CWD)).toEqual({ kind: "edit", path: "src/a.ts", tool: "edit", note: null });
    expect(piToolEvent("write", { path: "src/a.ts" }, CWD)).toEqual({ kind: "write", path: "src/a.ts", tool: "write", note: null });
    expect(piToolEvent("bash", { command: "rm -rf /" }, CWD)).toEqual({ kind: "tool", path: null, tool: "bash", note: null });
  });

  it("never puts the command in the note — only a description, exactly as the Claude tail does", () => {
    expect(piToolEvent("bash", { command: "npm test", description: "Run the unit tests" }, CWD).note).toBe("Run the unit tests");
  });

  it("makes an absolute path inside the cwd repo-relative", () => {
    expect(piToolEvent("read", { path: `${CWD}\\src\\a.ts` }, CWD).path).toBe("src/a.ts");
  });

  it("treats an unknown (extension-registered) tool as a generic tool call, by name", () => {
    expect(piToolEvent("web_search", { query: "x" }, CWD)).toEqual({ kind: "tool", path: null, tool: "web_search", note: null });
  });
});
