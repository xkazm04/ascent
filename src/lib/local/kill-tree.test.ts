// THE TREE KILL, BOTH BRANCHES, ON ONE HOST.
//
// Every platform-shaped thing is injected, so the win32 branch is testable on Linux CI and the POSIX
// branch on the Windows box this was written on. That is the whole reason `killProcessTree` takes
// deps at all: a kill path that can only be exercised on the platform it targets is a kill path that
// is exercised once, by hand, and then never again.
//
// MEASURED ON THIS HOST (win32, 2026-09-04): a real `node` grandchild behind a `shell: true` parent
// SURVIVED `child.kill()` and DIED to `taskkill /PID <pid> /T /F`. The defect and the fix are both
// real; these cases pin the argv and the honesty of the outcome.

import { describe, expect, it, vi } from "vitest";
import { KILL_TREE_GRACE_MS, detachForKillTree, killProcessTree } from "@/lib/local/kill-tree";

const errWith = (code: string) => Object.assign(new Error(code), { code });

describe("the win32 branch", () => {
  it("invokes taskkill with the tree+force argv, through execFile and never a shell", async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(null, "", ""));
    const r = await killProcessTree(1234, { platform: "win32", execFileImpl, graceMs: 1 });

    expect(execFileImpl).toHaveBeenCalledTimes(1);
    const [file, args] = execFileImpl.mock.calls[0];
    expect(file).toBe("taskkill");
    // `/T` is the tree — without it the grandchild that actually IS the claude session survives.
    expect(args).toEqual(["/PID", "1234", "/T", "/F"]);
    expect(r).toEqual({ confirmed: true, note: "agent process terminated (pid 1234)", pid: 1234 });
  });

  it("treats 'the process is not there' (exit 128) as CONFIRMED, not as a failure", async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(Object.assign(new Error("gone"), { code: 128 }), "", ""));
    const r = await killProcessTree(7, { platform: "win32", execFileImpl, graceMs: 1 });
    expect(r.confirmed).toBe(true);
  });

  it("says UNCONFIRMED when taskkill failed for any other reason", async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(Object.assign(new Error("nope"), { code: 1 }), "", Buffer.from("access denied")));
    const r = await killProcessTree(7, { platform: "win32", execFileImpl, graceMs: 1 });
    expect(r).toEqual({ confirmed: false, note: "agent process termination unconfirmed (pid 7)", pid: 7 });
  });

  it("never rejects, even when spawning taskkill throws outright", async () => {
    const execFileImpl = vi.fn(() => {
      throw new Error("ENOENT");
    });
    await expect(killProcessTree(7, { platform: "win32", execFileImpl, graceMs: 1 })).resolves.toMatchObject({ confirmed: false });
  });
});

describe("the posix branch", () => {
  it("signals the NEGATIVE pid — the process group, not just the shell", async () => {
    const seen: [number, string | number][] = [];
    const kill = vi.fn((pid: number, sig: NodeJS.Signals | 0) => {
      seen.push([pid, sig]);
      if (sig === 0 && seen.filter(([, s]) => s === 0).length > 1) throw errWith("ESRCH");
      if (sig === 0) throw errWith("ESRCH");
    });
    const r = await killProcessTree(42, { platform: "linux", kill, graceMs: 1 });

    expect(seen[0]).toEqual([-42, "SIGTERM"]);
    expect(seen.every(([pid]) => pid === -42)).toBe(true);
    expect(r.confirmed).toBe(true);
  });

  it("escalates to SIGKILL when the group is still alive after the grace", async () => {
    let alive = true;
    const seen: (string | number)[] = [];
    const kill = vi.fn((_pid: number, sig: NodeJS.Signals | 0) => {
      seen.push(sig);
      if (sig === "SIGKILL") alive = false;
      if (sig === 0 && !alive) throw errWith("ESRCH");
    });
    const r = await killProcessTree(42, { platform: "darwin", kill, graceMs: 1 });
    expect(seen).toContain("SIGTERM");
    expect(seen).toContain("SIGKILL");
    expect(r.confirmed).toBe(true);
  });

  it("is HONEST when the group outlives SIGKILL — an unconfirmed kill is a real outcome", async () => {
    // Nothing ever throws ESRCH: the group is still there. A note claiming "terminated" here would
    // be the single most misleading line the lane could write.
    const kill = vi.fn(() => {});
    const r = await killProcessTree(42, { platform: "linux", kill, graceMs: 1 });
    expect(r).toEqual({ confirmed: false, note: "agent process termination unconfirmed (pid 42)", pid: 42 });
  });
});

describe("nothing to kill", () => {
  it.each([null, undefined, 0, -1])("reports honestly and touches no platform call for pid %s", async (pid) => {
    const execFileImpl = vi.fn();
    const kill = vi.fn();
    const r = await killProcessTree(pid as number | null, { platform: "win32", execFileImpl, kill });
    expect(execFileImpl).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(r).toEqual({ confirmed: true, note: "agent process had no live pid to terminate", pid: null });
  });
});

describe("the spawn flag that makes the posix branch possible", () => {
  it("detaches everywhere except win32", () => {
    expect(detachForKillTree("win32")).toBe(false);
    expect(detachForKillTree("linux")).toBe(true);
    expect(detachForKillTree("darwin")).toBe(true);
  });

  it("keeps the grace short — this runs AFTER the lane is already free", () => {
    expect(KILL_TREE_GRACE_MS).toBeLessThan(10_000);
  });
});
