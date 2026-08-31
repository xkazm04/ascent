// THE A/B DEGRADATION GUARD — the four verdicts, the baseline cache, and the one path that reverses
// work.
//
// The cases here are the contract the lane and the delivery step both lean on: `rejected` is the ONLY
// verdict that sets `reject`, and `baseline-red` is emphatically not one — a repository that arrives
// broken must not cost an agent its cycle, or the loop becomes unusable on precisely the repositories
// that need it most.

import { beforeEach, describe, expect, it, vi } from "vitest";

const gitCalls: { cwd: string; args: readonly string[] }[] = [];
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (cwd: string, args: readonly string[]) => {
    gitCalls.push({ cwd, args });
    return { ok: true, stdout: "", stderr: "" };
  }),
}));

import {
  discardWorktreeEdits,
  __clearVerifyBaselines,
  forgetVerifyBaseline,
  verifyBaseline,
  verifyRejectionLesson,
  verifyResult,
  type GuardDeps,
  type VerifyRun,
} from "@/lib/local/lane-guard";
import type { ResolvedVerify } from "@/lib/local/lane-verify";

const CMD: ResolvedVerify = { command: "npm run check:ci", source: ".ai/manifest.yaml (ciHardPass)" };
const DIR = "C:/tmp/wt-guard";
const MS = 600_000;

const pass = (): VerifyRun => ({ ok: true, output: "all good", timedOut: false });
const fail = (): VerifyRun => ({ ok: false, output: "FAIL src/a.test.ts\nAssertionError: expected 1 to be 2", timedOut: false });

const deps = (over: Partial<GuardDeps> = {}): Partial<GuardDeps> => ({
  resolve: vi.fn(async () => CMD),
  run: vi.fn(async () => pass()),
  discard: vi.fn(async () => true),
  ...over,
});

beforeEach(() => __clearVerifyBaselines());

describe("the four verdicts", () => {
  it("VERIFIED — passed before, passes after", async () => {
    const d = deps();
    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);
    expect(out.verdict).toBe("verified");
    expect(out.reject).toBe(false);
    expect(out.command).toBe(CMD.command);
    expect(out.note).toContain("npm run check:ci");
  });

  it("REJECTED — passed before, fails after: discards the edits and refuses the cycle", async () => {
    const discard = vi.fn(async () => true);
    const run = vi.fn().mockResolvedValueOnce(pass()).mockResolvedValueOnce(fail());
    const d = deps({ run: run as unknown as GuardDeps["run"], discard });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("rejected");
    expect(out.reject).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith(DIR); // the WORKTREE, never a paired checkout
    // The note has to carry both halves the operator needs: which command, and what it said.
    expect(out.note).toContain("npm run check:ci");
    expect(out.note).toContain("AssertionError");
  });

  it("BASELINE-RED — already failing before the session: no blame, no rejection", async () => {
    const run = vi.fn(async () => fail());
    const discard = vi.fn(async () => true);
    const d = deps({ run: run as unknown as GuardDeps["run"], discard });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("baseline-red");
    expect(out.reject).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    expect(out.note).toContain("already failed");
    // AND it does not spend a second run: there is nothing to compare a red baseline against.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("BASELINE-RED distinguishes 'could not START' from 'the repository is broken'", async () => {
    // Since the lane worktree gets the paired checkout's dependency caches LINKED in
    // (`worktree-deps.ts`), a red baseline is a real claim about the repository — so the case where
    // the command still could not run (no `.venv` to link, an install step the loop cannot perform, a
    // link that failed) has to be phrased as a fact about the checkout instead. Same verdict, same
    // no-blame: a fifth verdict would be a new column and a new word for a reader to learn.
    const run = vi.fn(async (): Promise<VerifyRun> => ({ ok: false, output: "Error: Cannot find module 'vitest'", timedOut: false }));
    const d = deps({ run: run as unknown as GuardDeps["run"] });

    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d);

    expect(out.verdict).toBe("baseline-red");
    expect(out.reject).toBe(false);
    expect(out.note).toContain("could not START");
    expect(out.note).toContain("about this checkout rather than about the repository");
    expect(out.note).not.toContain("already failed");
  });

  it("SKIPPED — nothing resolvable, and it SAYS so rather than passing silently", async () => {
    const run = vi.fn(async () => pass());
    const d = deps({ resolve: vi.fn(async () => null), run: run as unknown as GuardDeps["run"] });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("skipped");
    expect(out.reject).toBe(false);
    expect(out.command).toBeNull();
    expect(out.note).toMatch(/declares no check/i);
    expect(out.note).toMatch(/UNVERIFIED, not verified/i);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the baseline", () => {
  it("is measured ONCE per worktree and recalled for later cycles", async () => {
    const resolve = vi.fn(async () => CMD);
    const run = vi.fn(async () => pass());
    const d = deps({ resolve, run: run as unknown as GuardDeps["run"] });

    await verifyBaseline(DIR, MS, d);
    await verifyBaseline(DIR, MS, d);
    await verifyBaseline(DIR, MS, d);

    // Cycle 2's HEAD already carries cycle 1's commits, so re-measuring would answer a different
    // question — "was the repo green after we changed it" — which is the result run's job.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is forgotten when its worktree is removed", async () => {
    const resolve = vi.fn(async () => CMD);
    const d = deps({ resolve });
    await verifyBaseline(DIR, MS, d);
    forgetVerifyBaseline(DIR);
    await verifyBaseline(DIR, MS, d);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown resolution as 'nothing declared', never as a pass", async () => {
    const d = deps({ resolve: vi.fn(async () => { throw new Error("disk gone"); }) });
    const base = await verifyBaseline(DIR, MS, d);
    expect(base.resolved).toBeNull();
    expect((await verifyResult(DIR, base, MS, d)).verdict).toBe("skipped");
  });
});

describe("the timeout path", () => {
  it("counts a baseline timeout as BASELINE-RED — honest, and it stops the guard costing every lane", async () => {
    const run = vi.fn(async () => ({ ok: false, output: "…", timedOut: true }) as VerifyRun);
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    expect((await verifyResult(DIR, base, MS, d)).verdict).toBe("baseline-red");
  });

  it("counts a RESULT timeout as a rejection, and says it timed out rather than failed", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(pass())
      .mockResolvedValueOnce({ ok: false, output: "hung", timedOut: true } as VerifyRun);
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);
    // A session that left the repository unable to get through its own checks IS a degradation.
    expect(out.verdict).toBe("rejected");
    expect(out.note).toContain("timed out");
  });

  it("says so when the edits could NOT be discarded, instead of claiming they were", async () => {
    const run = vi.fn().mockResolvedValueOnce(pass()).mockResolvedValueOnce(fail());
    const d = deps({ run: run as unknown as GuardDeps["run"], discard: vi.fn(async () => false) });
    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);
    expect(out.verdict).toBe("rejected");
    expect(out.note).toContain("could NOT be discarded");
  });
});

describe("the lesson candidate", () => {
  it("names the repository and the command, without the branch — it is a standing fact", async () => {
    const run = vi.fn().mockResolvedValueOnce(pass()).mockResolvedValueOnce(fail());
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    const lesson = verifyRejectionLesson("acme/web", await verifyResult(DIR, base, MS, d));
    expect(lesson).toContain("acme/web");
    expect(lesson).toContain("npm run check:ci");
    expect(lesson).not.toContain("ascent/loop-");
  });
});

describe("discarding a rejected cycle's edits", () => {
  it("resets AND cleans, in the worktree it was given and nowhere else", async () => {
    gitCalls.length = 0;
    expect(await discardWorktreeEdits(DIR)).toBe(true);

    // Both are needed: a session that "fixed" a module by adding a broken NEW one leaves nothing for
    // the reset to undo, and a worktree still carrying it would poison the next cycle's baseline.
    expect(gitCalls.map((c) => c.args.join(" "))).toEqual(["reset --hard HEAD", "clean -fd"]);
    // The bound that is the whole safety story: these are the two most destructive commands in the
    // codebase and they only ever run against the throwaway checkout.
    expect(gitCalls.every((c) => c.cwd === DIR)).toBe(true);
  });
});
