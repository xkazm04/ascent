// THE WORKTREE POLL under fake timers, with the git seam injected: what the stat counts, when it writes
// (only on change, heartbeat only after the first reading), that it never overlaps, and that stop means
// stop — including for a tick already in flight.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/loop-runs", () => ({ updateLane: vi.fn(async () => null) }));

import { parseDiffStat, startWorktreePoll } from "@/lib/local/worktree-poll";
import { WORKTREE_POLL_MS } from "@/lib/local/runner-types";
import type { GitResult } from "@/lib/local/git";

const ok = (stdout: string): GitResult => ({ ok: true, stdout, stderr: "" });

/** A git double whose answers the test changes between ticks. */
function fakeGit() {
  const state = { numstat: "", others: "", fail: false, calls: 0, delay: null as Promise<void> | null };
  const git = vi.fn(async (_cwd: string, args: readonly string[]) => {
    state.calls += 1;
    if (state.delay) await state.delay;
    if (state.fail) return { ok: false, stdout: "", stderr: "fatal" };
    return ok(args[0] === "diff" ? state.numstat : state.others);
  });
  return { state, git };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("parseDiffStat", () => {
  it("sums numstat, counts binary as 0 lines and untracked files as files", () => {
    const numstat = "10\t2\tsrc/a.ts\n-\t-\tlogo.png\n3\t0\tsrc/b.ts\n";
    expect(parseDiffStat(numstat, "new.ts\nnotes.md\n")).toEqual({ files: 5, plus: 13, minus: 2 });
    expect(parseDiffStat("", "")).toEqual({ files: 0, plus: 0, minus: 0 });
  });
});

describe("startWorktreePoll", () => {
  it("reads `git diff --numstat HEAD` and the untracked list in the lane's worktree, every WORKTREE_POLL_MS", async () => {
    const { git } = fakeGit();
    const write = vi.fn(async () => null);
    const stop = startWorktreePoll("/wt", "lane-1", { git, write });
    expect(git).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(git).toHaveBeenCalledWith("/wt", ["diff", "--numstat", "HEAD"]);
    expect(git).toHaveBeenCalledWith("/wt", ["ls-files", "--others", "--exclude-standard"]);
    stop();
  });

  it("writes the first reading WITHOUT a heartbeat, then only on change — each change stamping heartbeatAt", async () => {
    const { state, git } = fakeGit();
    const write = vi.fn(async () => null);
    const stop = startWorktreePoll("/wt", "lane-1", { git, write });
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).toHaveBeenLastCalledWith("lane-1", { diffStat: { files: 0, plus: 0, minus: 0 } });

    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS * 3);
    expect(write).toHaveBeenCalledTimes(1);

    state.numstat = "4\t1\tsrc/a.ts\n";
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("lane-1", { diffStat: { files: 1, plus: 4, minus: 1 }, heartbeatAt: expect.any(Date) });

    // Same totals, different file: still a change in the worktree, still a sign of life.
    state.numstat = "4\t1\tsrc/b.ts\n";
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).toHaveBeenCalledTimes(3);
    stop();
  });

  it("never overlaps itself — a tick that finds git still running is skipped", async () => {
    const { state, git } = fakeGit();
    let release!: () => void;
    state.delay = new Promise<void>((r) => (release = r));
    const write = vi.fn(async () => null);
    const stop = startWorktreePoll("/wt", "lane-1", { git, write });
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS * 4);
    expect(state.calls).toBe(2); // one tick's two git calls, the other three ticks skipped
    state.delay = null;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(state.calls).toBe(4);
    stop();
  });

  it("stop clears every timer, and a tick in flight at stop writes nothing", async () => {
    const { state, git } = fakeGit();
    let release!: () => void;
    state.delay = new Promise<void>((r) => (release = r));
    const write = vi.fn(async () => null);
    const stop = startWorktreePoll("/wt", "lane-1", { git, write });
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS * 3);
    expect(write).not.toHaveBeenCalled();
  });

  it("swallows git failures and write failures — a missed reading, never a lane failure", async () => {
    const { state, git } = fakeGit();
    state.fail = true;
    const write = vi.fn(async () => {
      throw new Error("db down");
    });
    const stop = startWorktreePoll("/wt", "lane-1", { git, write });
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).not.toHaveBeenCalled();
    state.fail = false;
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).toHaveBeenCalledTimes(1);
    // The failed write did not wedge the poll.
    state.others = "x.ts\n";
    await vi.advanceTimersByTimeAsync(WORKTREE_POLL_MS);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });
});
