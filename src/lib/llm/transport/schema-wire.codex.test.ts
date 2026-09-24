// Schema-constrained output through the codex spawn door (backlog develop-2026-09-17 row 44). The
// tool takes `--output-schema <FILE>`, so the schema travels as a TEMP FILE: written under
// os.tmpdir() (never the repo), uniquely named, owner-only where the platform honours modes, and
// deleted in a `finally` whichever way the run ends (success, CLI failure, timeout, abort). What is
// pinned is the argv the spawn door actually receives: a large schema must not appear in it —
// Windows caps a command line at 8191 chars through cmd.exe, and shell:true re-parses what it gets.

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { codexCliTransport } from "./codex";

const ANSWER = '{"answer":5}';
const JSONL = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ANSWER } });
const SCHEMA = { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false };

/** A schema far past any argv budget: ~120 KB of distinctively named properties. */
const BIG_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    Array.from({ length: 2000 }, (_, i) => [`dimension_property_${i}`, { type: "string", description: "x".repeat(30) }]),
  ),
};

type Child = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { write: () => void; end: () => void; destroyed: boolean }; kill: () => void };

/** Fake child; `close` null = never exits on its own (timeout / abort cases). */
function fakeChild(close: number | null, stdout = ""): Child {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { write: () => {}, end: () => {}, destroyed: false }),
    kill: () => {},
  });
  if (close !== null) {
    queueMicrotask(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.emit("close", close);
    });
  }
  return child;
}

/** The schema-file path as the spawn door received it (quoted for the shell:true command line). */
function schemaPathArg(call = 0): string {
  const argv = h.spawn.mock.calls[call][1] as string[];
  const i = argv.indexOf("--output-schema");
  expect(i).toBeGreaterThan(-1);
  const quoted = argv[i + 1];
  expect(quoted.startsWith('"') && quoted.endsWith('"')).toBe(true); // a spaced tmpdir survives the shell
  return quoted.slice(1, -1);
}

let seenDuringSpawn: { exists: boolean; body?: string; mode?: number }[] = [];
function spawnWith(close: number | null, stdout = "") {
  h.spawn.mockImplementation((_bin: string, argv: string[]) => {
    const i = argv.indexOf("--output-schema");
    const path = i > -1 ? argv[i + 1].slice(1, -1) : "";
    const exists = !!path && existsSync(path);
    seenDuringSpawn.push({ exists, body: exists ? readFileSync(path, "utf8") : undefined, mode: exists ? statSync(path).mode & 0o777 : undefined });
    return fakeChild(close, stdout);
  });
}

afterEach(() => {
  h.spawn.mockReset();
  seenDuringSpawn = [];
});

describe("codex adapter wires --output-schema through a temp file", () => {
  it("advertises the schema path as wired", () => {
    expect(codexCliTransport.capabilities.schemaOutput).toBe("schema-file");
    expect(codexCliTransport.capabilities.schemaWired).toBe(true);
  });

  it("a schema run succeeds and returns the parsed answer as json", async () => {
    spawnWith(0, JSONL);
    const res = await codexCliTransport.run({ prompt: "2+3?", mode: "generate", schema: SCHEMA });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.text).toBe(ANSWER);
    expect(res.json).toEqual({ answer: 5 });
  });

  it("writes the schema under os.tmpdir(), never inside the repo, and it holds the exact schema", async () => {
    spawnWith(0, JSONL);
    await codexCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA });
    const path = schemaPathArg();
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    expect(resolve(path).startsWith(resolve(process.cwd()) + sep)).toBe(false);
    expect(seenDuringSpawn[0].exists).toBe(true);
    expect(JSON.parse(seenDuringSpawn[0].body ?? "")).toEqual(SCHEMA);
    if (process.platform !== "win32") expect(seenDuringSpawn[0].mode).toBe(0o600);
  });

  it("a large schema never reaches the argument vector", async () => {
    spawnWith(0, JSONL);
    await codexCliTransport.run({ prompt: "x", mode: "generate", schema: BIG_SCHEMA });
    const argv = (h.spawn.mock.calls[0][1] as string[]).join(" ");
    expect(argv).not.toContain("dimension_property_");
    expect(argv).not.toContain('"type"');
    expect(argv.length).toBeLessThan(1024);
    expect(JSON.parse(seenDuringSpawn[0].body ?? "")).toEqual(BIG_SCHEMA);
  });

  it("two concurrent runs get distinct files", async () => {
    spawnWith(0, JSONL);
    await Promise.all([
      codexCliTransport.run({ prompt: "a", mode: "generate", schema: SCHEMA }),
      codexCliTransport.run({ prompt: "b", mode: "generate", schema: SCHEMA }),
    ]);
    expect(schemaPathArg(0)).not.toBe(schemaPathArg(1));
  });

  it("deletes the file and its directory after success", async () => {
    spawnWith(0, JSONL);
    await codexCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA });
    const path = schemaPathArg();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("deletes the file after a CLI failure", async () => {
    spawnWith(1);
    const res = await codexCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA });
    expect(res.error?.kind).toBe("exit");
    expect(existsSync(schemaPathArg())).toBe(false);
  });

  it("deletes the file after a timeout", async () => {
    spawnWith(null);
    const res = await codexCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA, timeoutMs: 1_000 });
    expect(res.error?.kind).toBe("timeout");
    expect(existsSync(schemaPathArg())).toBe(false);
  });

  it("deletes the file after an abort", async () => {
    spawnWith(null);
    const controller = new AbortController();
    const pending = codexCliTransport.run({ prompt: "x", mode: "generate", schema: SCHEMA, signal: controller.signal });
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalled());
    controller.abort(new Error("client went away"));
    const res = await pending;
    expect(res.error?.kind).toBe("aborted");
    expect(existsSync(schemaPathArg())).toBe(false);
  });

  it("guard: a run without a schema passes no --output-schema flag", async () => {
    spawnWith(0, JSONL);
    const res = await codexCliTransport.run({ prompt: "x", mode: "generate" });
    expect(res.ok).toBe(true);
    expect(res.json).toBeUndefined();
    expect(h.spawn.mock.calls[0][1]).not.toContain("--output-schema");
  });
});
