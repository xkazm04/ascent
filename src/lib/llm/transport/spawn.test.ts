import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));
import { captureCli } from "./spawn";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); h.spawn.mockReset(); });

function run(signal?: AbortSignal) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn(), end: vi.fn() }),
    kill: vi.fn(() => true),
  });
  h.spawn.mockReturnValue(child);
  const result = captureCli({ bin: "fixture", args: [], cwd: ".", env: {}, stdin: "prompt", timeoutMs: 1000, label: "Fixture CLI", signal });
  return { child, result };
}

describe("CLI output byte boundaries", () => {
  it("preserves UTF-8 characters split across stdout chunks", async () => {
    const { child, result } = run();
    const expected = '{"answer":"Příliš 🦊 中文"}';
    for (const byte of Buffer.from(expected)) child.stdout.emit("data", Buffer.from([byte]));
    child.emit("close", 0);
    await expect(result).resolves.toBe(expected);
  });

  it("preserves split UTF-8 in the separate error channel", async () => {
    const { child, result } = run();
    const failure = result.catch(e => e);
    for (const byte of Buffer.from("Žlutý kůň")) child.stderr.emit("data", Buffer.from([byte]));
    child.emit("close", 1);
    expect((await failure).message).toBe("Fixture CLI exited 1: Žlutý kůň");
  });

  it("enforces the 4 MiB stdout cap in bytes for multibyte text", async () => {
    const { child, result } = run();
    const outcome = result.then(() => ({ kind: "resolved" }), e => e);
    child.stdout.emit("data", Buffer.from("界".repeat(Math.ceil(4 * 1024 * 1024 / 3))));
    child.emit("close", 0);
    expect((await outcome).kind).toBe("output-cap");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("accepts output exactly at the cap", async () => {
    const { child, result } = run();
    child.stdout.emit("data", Buffer.alloc(4 * 1024 * 1024, "a"));
    child.emit("close", 0);
    expect((await result).length).toBe(4 * 1024 * 1024);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
