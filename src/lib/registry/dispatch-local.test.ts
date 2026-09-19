// The local dispatch runner, driven entirely through fakes. What is load-bearing:
//   • the row ends `proposed` (with branch + PR) or `failed` (with the reason) — NEVER `done`, which
//     only the sweep may write;
//   • a session that left nothing on the branch is a failure with the exact sentence the UI shows;
//   • the worktree is removed on every path, and the one-repo sweep runs after every path;
//   • the agent's envelope (model, cost, turns, duration, summary) lands on the row.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISPATCH_TRAILER_KEY } from "./dispatch-brief";
import { detectDefaultBranch, localPostscript, runLocalDispatch, type DispatchLocalDeps, type LocalDispatchInput } from "./dispatch-local";

type Patch = Record<string, unknown>;

function fakes(over: Partial<DispatchLocalDeps> = {}) {
  const marks: Patch[] = [];
  const gitCalls: { cwd: string; args: readonly string[] }[] = [];
  const state = { dirty: true, commits: "1", pushOk: true };
  const wt = { dir: "/tmp/wt", branch: "ascent/registry-20260906000000-acme-api", pairedPath: "/repos/api", linkedDeps: [], depNotes: [] };
  const deps: DispatchLocalDeps = {
    createWorktree: vi.fn(async () => wt),
    removeWorktree: vi.fn(async () => {}),
    runAgent: vi.fn(async () => ({ ok: true, summary: "did the thing", model: "sonnet", costMicros: 1200, turns: 4, durationMs: 9000 })),
    git: vi.fn(async (cwd: string, args: readonly string[]) => {
      gitCalls.push({ cwd, args });
      if (args[0] === "rev-parse") return { ok: true, stdout: "basesha\n", stderr: "" };
      if (args[0] === "status") return { ok: true, stdout: state.dirty ? " M .ai/registry-map.json\n" : "", stderr: "" };
      if (args[0] === "rev-list") return { ok: true, stdout: `${state.commits}\n`, stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    }),
    mark: vi.fn(async (_org: string, _id: string, patch: Patch) => {
      marks.push(patch);
      return null;
    }),
    openPr: vi.fn(async () => ({ prNumber: 7, prUrl: "https://github.com/acme/api/pull/7", reused: false })),
    sweep: vi.fn(async () => ({ scanned: 1, withMap: 1, withoutMap: 0, pairs: 3, warnings: [] })),
    now: () => new Date("2026-09-06T00:00:00Z"),
    ...over,
  };
  return { deps, marks, gitCalls, state, wt };
}

const input: LocalDispatchInput = {
  orgId: "org-1",
  dispatchId: "d-1",
  stage: "map",
  repo: { repositoryId: "repo-0", fullName: "acme/api", defaultBranch: "main", localPath: "/repos/api" },
  brief: "# brief",
  token: "tok",
};

beforeEach(() => vi.clearAllMocks());

describe("runLocalDispatch", () => {
  it("runs the brief in the worktree, commits the residue with the trailer, pushes, opens the PR and marks proposed", async () => {
    const f = fakes();
    await runLocalDispatch(f.deps, input);

    expect(f.deps.createWorktree).toHaveBeenCalledWith("/repos/api", "acme/api", "20260906000000");
    const prompt = (f.deps.runAgent as ReturnType<typeof vi.fn>).mock.calls[0]![0].prompt as string;
    expect(prompt.startsWith("# brief")).toBe(true);
    expect(prompt).toContain("DO NOT run git");

    const commit = f.gitCalls.find((c) => c.args[0] === "commit");
    expect(commit?.cwd).toBe("/tmp/wt");
    expect(commit?.args.join(" ")).toContain(`${DISPATCH_TRAILER_KEY}: d-1`);

    expect(f.deps.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", owner: "acme", repo: "api", pairedPath: "/repos/api", head: f.wt.branch, base: "main" }),
    );
    expect(f.marks[0]).toMatchObject({ status: "running", model: "sonnet", costMicros: 1200, turns: 4, agentDurationMs: 9000, summary: "did the thing" });
    expect(f.marks[1]).toEqual({ status: "proposed", branch: f.wt.branch, prUrl: "https://github.com/acme/api/pull/7", endedAt: new Date("2026-09-06T00:00:00Z") });
    expect(f.marks.some((m) => m.status === "done")).toBe(false);
    expect(f.deps.removeWorktree).toHaveBeenCalledWith(f.wt);
    expect(f.deps.sweep).toHaveBeenCalledWith({ orgId: "org-1" }, "tok", { repositoryId: "repo-0" });
  });

  it("fails with the exact sentence when the session left no commits", async () => {
    const f = fakes();
    f.state.dirty = false;
    f.state.commits = "0";
    await runLocalDispatch(f.deps, input);
    expect(f.gitCalls.some((c) => c.args[0] === "commit")).toBe(false);
    expect(f.deps.openPr).not.toHaveBeenCalled();
    expect(f.marks.at(-1)).toMatchObject({ status: "failed", error: "the agent produced no commits", branch: f.wt.branch });
    expect(f.deps.removeWorktree).toHaveBeenCalledTimes(1);
    expect(f.deps.sweep).toHaveBeenCalledTimes(1);
  });

  it("fails with the session's own reason when the agent did not finish, and still records its envelope", async () => {
    const f = fakes({ runAgent: vi.fn(async () => ({ ok: false, summary: "Agent session exceeded 20 min and was stopped.", model: "sonnet" })) });
    await runLocalDispatch(f.deps, input);
    expect(f.marks[0]).toMatchObject({ status: "running", summary: "Agent session exceeded 20 min and was stopped." });
    expect(f.marks.at(-1)).toMatchObject({ status: "failed", error: "Agent session exceeded 20 min and was stopped." });
    expect(f.deps.openPr).not.toHaveBeenCalled();
  });

  it("fails with the PR helper's message when the push or the PR is refused", async () => {
    const f = fakes({ openPr: vi.fn(async () => { throw new Error("Could not push: non-fast-forward"); }) });
    await runLocalDispatch(f.deps, input);
    expect(f.marks.at(-1)).toMatchObject({ status: "failed", error: "Could not push: non-fast-forward" });
    expect(f.deps.removeWorktree).toHaveBeenCalledTimes(1);
  });

  it("fails without touching the agent when the worktree cannot be made, and removes nothing", async () => {
    const f = fakes({ createWorktree: vi.fn(async () => { throw new Error("Could not create the worktree for acme/api: dirty"); }) });
    await runLocalDispatch(f.deps, input);
    expect(f.deps.runAgent).not.toHaveBeenCalled();
    expect(f.deps.removeWorktree).not.toHaveBeenCalled();
    expect(f.marks).toEqual([expect.objectContaining({ status: "failed", branch: null, error: "Could not create the worktree for acme/api: dirty" })]);
    expect(f.deps.sweep).toHaveBeenCalledTimes(1);
  });

  it("never throws — a ledger write failure and a sweep failure are both swallowed", async () => {
    const f = fakes({
      mark: vi.fn(async () => { throw new Error("db down"); }),
      sweep: vi.fn(async () => { throw new Error("github down"); }),
    });
    await expect(runLocalDispatch(f.deps, input)).resolves.toBeUndefined();
    expect(f.deps.removeWorktree).toHaveBeenCalledTimes(1);
  });
});

describe("localPostscript", () => {
  it("names the branch and the trailer the runner will write", () => {
    const text = localPostscript("ascent/registry-x");
    expect(text).toContain("`ascent/registry-x`");
    expect(text).toContain(DISPATCH_TRAILER_KEY);
    expect(text).toContain("NEVER push");
  });
});

describe("detectDefaultBranch", () => {
  it("reads origin/HEAD from the paired checkout and strips the remote", async () => {
    const git = vi.fn(async () => ({ ok: true, stdout: "origin/develop\n", stderr: "" }));
    expect(await detectDefaultBranch("/repos/api", git)).toBe("develop");
    expect(git).toHaveBeenCalledWith("/repos/api", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  });
  it("falls back to main when unpaired or when git does not say", async () => {
    expect(await detectDefaultBranch(null)).toBe("main");
    const git = vi.fn(async () => ({ ok: false, stdout: "", stderr: "fatal: ref refs/remotes/origin/HEAD is not a symbolic ref" }));
    expect(await detectDefaultBranch("/repos/api", git)).toBe("main");
  });
});
