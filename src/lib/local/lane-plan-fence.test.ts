// THE FENCE — against a REAL paired repository and a REAL linked worktree, because what this module
// promises is about git state: the held commits survive on a branch the paired repo can see, and the
// lane branch (and only the lane branch) is reset.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settleExecutingPlan = vi.fn(async () => true);
const holdExecutingPlan = vi.fn<(input: { planId: string; heldBranch: string | null; explanation: string }) => Promise<null>>(async () => null);
vi.mock("@/lib/db/loop-plans-write", () => ({ settleExecutingPlan, holdExecutingPlan }));

import { checkPlanFence } from "./lane-plan-fence";
import type { LoopWorktree } from "./loop-worktree";
import type { ArchitectureMove } from "./runner-types";

const roots: string[] = [];
let paired = "";
let wt: LoopWorktree;
let before = "";
const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const write = (dir: string, rel: string, body = "export {};\n") => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body, "utf8");
};
const commitAll = (dir: string, msg: string) => {
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", msg);
};

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "ascent-fence-"));
  roots.push(root);
  paired = join(root, "paired");
  mkdirSync(paired);
  gitIn(paired, "init", "-q");
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) gitIn(paired, "config", k!, v!);
  for (const f of ["src/lib/db/a.ts", "src/lib/db/b.ts", "src/lib/local/c.ts", "src/app/api/r.ts"]) write(paired, f);
  commitAll(paired, "seed");
  const dir = join(root, "wt");
  gitIn(paired, "worktree", "add", "-q", "-b", "ascent/loop-t", dir);
  wt = { dir, branch: "ascent/loop-t", pairedPath: paired, linkedDeps: [], depNotes: [] };
  before = gitIn(dir, "rev-parse", "HEAD");
  settleExecutingPlan.mockClear();
  holdExecutingPlan.mockClear();
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const check = (over: { declaredMoves?: ArchitectureMove[]; directionFence?: string[] | null; planId?: string | null; worktree?: LoopWorktree; before?: string } = {}) =>
  checkPlanFence({
    org: "acme",
    repo: "acme/web",
    laneId: "lane-9",
    worktree: over.worktree ?? wt,
    before: over.before ?? before,
    planId: over.planId === undefined ? "plan-1" : over.planId,
    declaredMoves: over.declaredMoves ?? [],
    directionFence: over.directionFence ?? null,
  });

describe("checkPlanFence", () => {
  it("lands a diff with no architecture move and settles the plan as landed", async () => {
    write(wt.dir, "src/lib/db/a.ts", "export const a = 1;\n");
    commitAll(wt.dir, "edit");
    const head = gitIn(wt.dir, "rev-parse", "HEAD");
    expect(await check()).toEqual({ verdict: "land" });
    expect(settleExecutingPlan).toHaveBeenCalledWith("plan-1", "landed");
    expect(gitIn(wt.dir, "rev-parse", "HEAD")).toBe(head);
  });

  it("HOLDS an undeclared cross-module move: commits kept on the held branch, lane branch reset, plan re-asked", async () => {
    gitIn(wt.dir, "mv", "src/lib/db/a.ts", "src/lib/local/a.ts");
    commitAll(wt.dir, "move");
    const moved = gitIn(wt.dir, "rev-parse", "HEAD");
    const res = await check();
    expect(res).toMatchObject({ verdict: "held", heldBranch: "ascent/held/plan-1" });
    if (res.verdict !== "held") throw new Error("expected held");
    expect(res.reason).toContain("cross-module-move src/lib/db/ → src/lib/local/");
    expect(gitIn(wt.dir, "rev-parse", "HEAD")).toBe(before);
    expect(gitIn(wt.dir, "status", "--porcelain")).toBe("");
    // The evidence lives in the PAIRED repository's refs, so it outlives the throwaway worktree.
    expect(gitIn(paired, "rev-parse", "ascent/held/plan-1")).toBe(moved);
    expect(gitIn(paired, "rev-parse", "HEAD")).toBe(before);
    expect(holdExecutingPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-1", heldBranch: "ascent/held/plan-1" }));
    expect(settleExecutingPlan).not.toHaveBeenCalled();
  });

  it("lands the same move when the plan DECLARED it", async () => {
    gitIn(wt.dir, "mv", "src/lib/db/a.ts", "src/lib/local/a.ts");
    commitAll(wt.dir, "move");
    expect(await check({ declaredMoves: [{ kind: "cross-module-move", from: "src/lib/db/", to: "src/lib/local/" }] })).toEqual({ verdict: "land" });
  });

  it("lands a move wholly inside the approved direction's fence, holds one outside it", async () => {
    write(wt.dir, "src/lib/fresh/x.ts");
    commitAll(wt.dir, "new module");
    expect(await check({ directionFence: ["src/lib/"] })).toEqual({ verdict: "land" });
    expect((await check({ directionFence: ["src/app/"] })).verdict).toBe("held");
  });

  it("names the held branch after the lane when there is no plan row, and records no hold", async () => {
    write(wt.dir, "src/lib/fresh/x.ts");
    commitAll(wt.dir, "new module");
    expect(await check({ planId: null })).toMatchObject({ verdict: "held", heldBranch: "ascent/held/lane-9" });
    expect(holdExecutingPlan).not.toHaveBeenCalled();
  });

  it("fails CLOSED on a diff it cannot read", async () => {
    write(wt.dir, "src/lib/db/a.ts", "x\n");
    commitAll(wt.dir, "edit");
    const res = await check({ before: "0".repeat(40) });
    expect(res.verdict).toBe("held");
    if (res.verdict === "held") expect(res.reason).toContain("could not read this cycle's diff");
  });

  it("never resets the operator's own checkout", async () => {
    gitIn(paired, "checkout", "-q", "-b", "side");
    gitIn(paired, "mv", "src/lib/db/a.ts", "src/lib/local/a.ts");
    commitAll(paired, "move in the paired checkout");
    const head = gitIn(paired, "rev-parse", "HEAD");
    const res = await check({ worktree: { ...wt, dir: paired, branch: "side" } });
    expect(res).toMatchObject({ verdict: "held", heldBranch: null });
    expect(gitIn(paired, "rev-parse", "HEAD")).toBe(head);
  });
});
