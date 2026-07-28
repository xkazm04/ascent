// G3-27: runClaudePrompt had no internal production guard of its own — assess() (via
// LazyClaudeCliProvider) throws whenever NODE_ENV === "production", but the general-purpose sibling
// used by non-scan callers (e.g. Shared Org Memory consolidation) relied entirely on every caller
// correctly re-deriving the providerAvailable("claude-cli") + dynamic-import convention. Verify the
// function now fails fast on its own in a production build, matching assess()'s defense-in-depth.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { runClaudePrompt } from "./claude-cli";

/** Minimal fake ChildProcess: no stdout/stderr data, exits immediately with the given code. */
function fakeChild(exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: () => void; end: () => void; destroyed: boolean };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), {
    write: () => {},
    end: () => {},
    destroyed: false,
  });
  child.kill = () => {};
  queueMicrotask(() => child.emit("close", exitCode));
  return child;
}

afterEach(() => {
  vi.unstubAllEnvs();
  h.spawn.mockReset();
});

describe("runClaudePrompt (local-dev-only production guard)", () => {
  it("throws immediately when NODE_ENV is production, before ever spawning the CLI", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(runClaudePrompt("hello")).rejects.toThrow(
      /local-dev-only.*not available in production/i,
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("does not fire the production guard outside production (falls through to the real call path)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    h.spawn.mockImplementation(() => fakeChild(1)); // exit 1 — asserts we got PAST the guard, not that it "succeeds"
    await expect(runClaudePrompt("hello")).rejects.not.toThrow(/local-dev-only/i);
    expect(h.spawn).toHaveBeenCalled();
  });
});
