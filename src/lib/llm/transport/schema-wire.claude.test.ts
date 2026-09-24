// Schema-constrained output through the claude spawn door (backlog develop-2026-09-17 row 44).
// Unlike codex, claude has NO file form: `--json-schema <schema>` takes the JSON text itself (the
// 2.1.281 binary JSON.parses the flag value: "Error: --json-schema is not valid JSON"), so a temp
// file cannot carry it. The schema instead rides the child's STDIN as the `initialize` control
// request of the stream-json input protocol (the one the Agent SDK speaks), and the answer comes back
// as the final `result` event's `structured_output`. Verified live on 2026-09-24 (claude 2.1.281,
// haiku). What is pinned: the schema never touches argv, the non-schema path is byte-identical.

import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ spawn: vi.fn(), stdin: [] as string[] }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { claudeCliTransport } from "./claude";

const SCHEMA = { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"] };
const BIG_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`dimension_property_${i}`, { type: "string" }])),
};
const usage = { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** A realistic stream-json capture: hook noise, the init control_response, assistant turns, result. */
function stream(result: Record<string, unknown>): string {
  return [
    { type: "system", subtype: "hook_started" },
    { type: "control_response", response: { subtype: "success", request_id: "ascent-init", response: {} } },
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [] } },
    { type: "result", subtype: "success", is_error: false, result: '{"answer":5}', structured_output: { answer: 5 }, usage, ...result },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
}

function fakeChild(close: number, stdout = "") {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { write: (s: string) => h.stdin.push(s), end: () => {}, destroyed: false }),
    kill: () => {},
  });
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", stdout);
    child.emit("close", close);
  });
  return child;
}

const argv = () => h.spawn.mock.calls[0][1] as string[];
const stdinLines = () => h.stdin.join("").split("\n").filter(Boolean).map((l) => JSON.parse(l));

afterEach(() => {
  h.spawn.mockReset();
  h.stdin = [];
});

describe("claude adapter wires the schema through stdin, not argv", () => {
  it("advertises the schema path as wired over the stdin control channel", () => {
    expect(claudeCliTransport.capabilities.schemaOutput).toBe("stdin-control");
    expect(claudeCliTransport.capabilities.schemaWired).toBe(true);
  });

  it("a schema run succeeds and returns structured_output as json", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, stream({})));
    const res = await claudeCliTransport.run({ prompt: "2+3?", mode: "generate", schema: SCHEMA, model: "haiku" });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.json).toEqual({ answer: 5 });
    expect(res.text).toBe('{"answer":5}');
  });

  it("speaks stream-json both ways and sends initialize{jsonSchema} before the prompt", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, stream({})));
    await claudeCliTransport.run({ prompt: 'quote " and\nnewline', mode: "generate", schema: SCHEMA, model: "haiku" });
    expect(argv()).toEqual(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", "haiku"]);
    const [init, user] = stdinLines();
    expect(init).toMatchObject({ type: "control_request", request: { subtype: "initialize", jsonSchema: SCHEMA } });
    expect(user).toMatchObject({ type: "user", message: { role: "user", content: 'quote " and\nnewline' } });
    expect((h.spawn.mock.calls[0][2] as { cwd: string }).cwd).toBe(tmpdir());
  });

  it("a large schema never reaches the argument vector", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, stream({})));
    await claudeCliTransport.run({ prompt: "x", mode: "generate", schema: BIG_SCHEMA, model: "haiku" });
    const line = argv().join(" ");
    expect(line).not.toContain("dimension_property_");
    expect(line).not.toContain("--json-schema");
    expect(line.length).toBeLessThan(1024);
    expect(stdinLines()[0].request.jsonSchema).toEqual(BIG_SCHEMA);
  });

  it("an is_error result event is a typed envelope failure carrying the tool's subtype", async () => {
    const failed = stream({ subtype: "error_max_structured_output_retries", is_error: true, result: "gave up", structured_output: undefined });
    h.spawn.mockImplementation(() => fakeChild(0, failed));
    const res = await claudeCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA });
    expect(res.ok).toBe(false);
    expect(res.error).toMatchObject({ kind: "envelope", subtype: "error_max_structured_output_retries" });
  });

  it("a stream with no result event is a typed envelope failure, not an empty success", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, '{"type":"system","subtype":"init"}'));
    const res = await claudeCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("envelope");
    expect(res.error?.message).toMatch(/no result event/);
  });

  it("guard: a run without a schema keeps the single-json argv and the bare prompt on stdin", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, JSON.stringify({ is_error: false, result: "hi" })));
    const res = await claudeCliTransport.run({ prompt: "hello", mode: "generate", model: "sonnet" });
    expect(res).toMatchObject({ ok: true, text: "hi" });
    expect(res.json).toBeUndefined();
    expect(argv()).toEqual(["-p", "--output-format", "json", "--model", "sonnet"]);
    expect(h.stdin.join("")).toBe("hello");
  });

  it("guard: a shell-metacharacter model is still refused before any spawn", async () => {
    const res = await claudeCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA, model: "haiku; rm -rf x" });
    expect(res.error?.kind).toBe("config");
    expect(h.spawn).not.toHaveBeenCalled();
  });
});
