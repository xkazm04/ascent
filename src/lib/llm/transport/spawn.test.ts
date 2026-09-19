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

describe("CLI terminal cleanup without a close event", () => {
  it("clears the timeout immediately on abort", async () => {
    const controller = new AbortController();
    const { child, result } = run(controller.signal);
    const failure = result.catch(e => e);
    const reason = new Error("disconnected");
    controller.abort(reason);
    expect(await failure).toMatchObject({ kind: "aborted", cause: reason });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("removes the abort listener when the timeout wins", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { child, result } = run(controller.signal);
    const failure = result.catch(e => e);
    vi.advanceTimersByTime(1000);
    expect(await failure).toMatchObject({ kind: "timeout" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    child.emit("close", 0);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("terminates the child when input delivery fails", async () => {
    const { child, result } = run();
    const failure = result.catch(e => e);
    const reason = new Error("broken pipe");
    child.stdin.emit("error", reason);
    expect(await failure).toMatchObject({ kind: "spawn", cause: reason });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no cancellation work after successful close", async () => {
    const controller = new AbortController();
    const { child, result } = run(controller.signal);
    child.emit("close", 0);
    await expect(result).resolves.toBe("");
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
