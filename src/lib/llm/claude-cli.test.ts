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

describe("runClaudePrompt (managed-deployment guard)", () => {
  // The guard reads cliProviderAllowed() — the SAME predicate the CLI provider's assess() uses — so
  // this surface can never disagree with the provider about whether a `claude` binary is reachable.
  // The suite pins ASCENT_SELF_HOSTED=0 (vitest.config.js), so "production" here is managed cloud.
  it("throws immediately on a managed production deployment, before ever spawning the CLI", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(runClaudePrompt("hello")).rejects.toThrow(/not available on this managed deployment/i);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  // The self-hosting unblock, asserted on THIS surface too. Shared Org Memory's write-intelligence
  // pass calls runClaudePrompt; had the two guards drifted, unblocking the CLI provider would have
  // left that feature dead on exactly the deployments that had just gained a working CLI.
  it("falls through on a self-hosted production deployment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASCENT_SELF_HOSTED", "1");
    h.spawn.mockImplementation(() => fakeChild(1)); // exit 1 — asserts we got PAST the guard
    await expect(runClaudePrompt("hello")).rejects.not.toThrow(/managed deployment/i);
    expect(h.spawn).toHaveBeenCalled();
  });

  it("does not fire the guard outside production (falls through to the real call path)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    h.spawn.mockImplementation(() => fakeChild(1)); // exit 1 — asserts we got PAST the guard, not that it "succeeds"
    await expect(runClaudePrompt("hello")).rejects.not.toThrow(/managed deployment/i);
    expect(h.spawn).toHaveBeenCalled();
  });
});
