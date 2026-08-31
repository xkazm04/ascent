// THE A/B DEGRADATION GUARD — the four verdicts, the baseline cache, and the one path that reverses
// work.
//
// The cases here are the contract the lane and the delivery step both lean on: `rejected` is the ONLY
// verdict that sets `reject`, and `baseline-unavailable` is emphatically not one — a repository that arrives
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

const CMD: ResolvedVerify = { command: "npm run check:ci", source: ".ai/manifest.yaml (ciHardPass)", rung: "primary" };
const TYPES: ResolvedVerify = { command: "npm run typecheck", source: "package.json (scripts.typecheck)", rung: "typecheck" };
const LINT: ResolvedVerify = { command: "npm run lint", source: "package.json (scripts.lint)", rung: "lint" };
const DIR = "C:/tmp/wt-guard";
const MS = 600_000;

const pass = (): VerifyRun => ({ ok: true, output: "all good", timedOut: false });
const fail = (): VerifyRun => ({ ok: false, output: "FAIL src/a.test.ts\nAssertionError: expected 1 to be 2", timedOut: false });

const deps = (over: Partial<GuardDeps> = {}): Partial<GuardDeps> => ({
  resolveLadder: vi.fn(async () => [CMD]),
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

  it("BASELINE-UNAVAILABLE — no baseline could be established here: no blame, no rejection", async () => {
    const run = vi.fn(async () => fail());
    const discard = vi.fn(async () => true);
    const d = deps({ run: run as unknown as GuardDeps["run"], discard });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("baseline-unavailable");
    expect(out.reject).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    expect(out.note).toContain("did not pass on the pristine lane worktree");
    // AND it does not spend a second run: there is nothing to compare against.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the note does NOT accuse the repository, and DOES tell the operator what would fix it", async () => {
    // THE CORRECTION. This note used to say the command "already failed on this repository before the
    // session started", which the measurement never supported: a worktree carries tracked files plus
    // linked dependency caches and none of the operator's gitignored local state. `systedo-case`
    // passes 3744/3744 in the paired checkout and fails 8 in a worktree, on missing Google
    // application-default credentials.
    const run = vi.fn(async () => fail());
    const d = deps({ run: run as unknown as GuardDeps["run"] });

    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d);

    expect(out.note).not.toMatch(/already failed on this repository/i);
    expect(out.note).toContain("NOT evidence that the repository's own checks fail elsewhere");
    expect(out.note).toContain("controls.ciHardPass");
    expect(out.note).toContain("verifyMode");
  });

  it("distinguishes 'could not START at all' from 'did not pass here' — same verdict, sharper sentence", async () => {
    const run = vi.fn(async (): Promise<VerifyRun> => ({ ok: false, output: "Error: Cannot find module 'vitest'", timedOut: false }));
    const d = deps({ run: run as unknown as GuardDeps["run"] });

    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d);

    expect(out.verdict).toBe("baseline-unavailable");
    expect(out.reject).toBe(false);
    expect(out.note).toContain("could not START on the pristine lane worktree");
    expect(out.note).toContain("fact about this worktree");
    expect(out.note).not.toContain("did not pass on the pristine lane worktree, before");
  });

  it("SKIPPED — nothing resolvable, and it SAYS so rather than passing silently", async () => {
    const run = vi.fn(async () => pass());
    const d = deps({ resolveLadder: vi.fn(async () => []), run: run as unknown as GuardDeps["run"] });

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
    const resolveLadder = vi.fn(async () => [CMD]);
    const run = vi.fn(async () => pass());
    const d = deps({ resolveLadder, run: run as unknown as GuardDeps["run"] });

    await verifyBaseline(DIR, MS, d);
    await verifyBaseline(DIR, MS, d);
    await verifyBaseline(DIR, MS, d);

    // Cycle 2's HEAD already carries cycle 1's commits, so re-measuring would answer a different
    // question — "was the repo green after we changed it" — which is the result run's job.
    expect(resolveLadder).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is forgotten when its worktree is removed", async () => {
    const resolveLadder = vi.fn(async () => [CMD]);
    const d = deps({ resolveLadder });
    await verifyBaseline(DIR, MS, d);
    forgetVerifyBaseline(DIR);
    await verifyBaseline(DIR, MS, d);
    expect(resolveLadder).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown resolution as 'nothing declared', never as a pass", async () => {
    const d = deps({ resolveLadder: vi.fn(async () => { throw new Error("disk gone"); }) });
    const base = await verifyBaseline(DIR, MS, d);
    expect(base.resolved).toBeNull();
    expect((await verifyResult(DIR, base, MS, d)).verdict).toBe("skipped");
  });
});

describe("the timeout path", () => {
  it("counts a baseline timeout as BASELINE-UNAVAILABLE — honest, and it stops the guard costing every lane", async () => {
    const run = vi.fn(async () => ({ ok: false, output: "…", timedOut: true }) as VerifyRun);
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    expect((await verifyResult(DIR, base, MS, d)).verdict).toBe("baseline-unavailable");
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

// ── THE NARROWING LADDER ──────────────────────────────────────────────────────────────────────
//
// A git worktree is not a runnable environment for a realistic application: it carries tracked files
// plus the dependency caches the loop links, and none of the gitignored credentials, service config
// or local databases a full suite needs. Measured on both campaign repos at the same commit,
// `xkazm04/systedo-case` fails 8 tests there (all Google application-default credentials) and
// `xkazm04/kp` fails 2 — while both pass in the operator's checkout. So the primary could never
// establish a baseline, the guard protected nothing, and delivery was blocked on every lane.
//
// A weaker guard is still a guard, PROVIDED every surface says how weak it is. These cases pin both
// halves: which rung is taken, and that the word "narrowed" travels with the verdict.
describe("the narrowing ladder", () => {
  it("takes the PRIMARY when it passes, and is byte-identical to the pre-ladder verdict", async () => {
    const run = vi.fn(async () => pass());
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES, LINT]), run: run as unknown as GuardDeps["run"] });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    // The narrower rungs are never even spawned: one baseline run, one result run.
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((c) => c[1] === CMD.command)).toBe(true);
    expect(base.narrowedFrom).toBeNull();
    expect(out.verdict).toBe("verified");
    expect(out.rung).toBe("primary");
    expect(out.note).toBe("Verified: `npm run check:ci` (from .ai/manifest.yaml (ciHardPass)) passed before this session and passes after it.");
  });

  it("falls to TYPECHECK when the primary cannot establish a baseline — and says so everywhere", async () => {
    const run = vi.fn(async (_d: string, command: string) => (command === CMD.command ? fail() : pass()));
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES, LINT]), run: run as unknown as GuardDeps["run"] });

    const base = await verifyBaseline(DIR, MS, d);
    expect(base.passed).toBe(true);
    expect(base.resolved).toEqual(TYPES);
    expect(base.narrowedFrom).toEqual(CMD);
    // It stops at the first rung that passes: lint is not run.
    expect(run.mock.calls.map((c) => c[1])).toEqual([CMD.command, TYPES.command]);

    const out = await verifyResult(DIR, base, MS, d);
    expect(out.verdict).toBe("verified");
    expect(out.rung).toBe("typecheck");
    expect(out.command).toBe(TYPES.command);
    // The reader must never take this for a green suite.
    expect(out.note).toContain("NARROWED");
    expect(out.note).toContain("`npm run typecheck` ONLY");
    expect(out.note).toContain("the tests were NOT run");
    expect(out.note).toContain("npm run check:ci");
  });

  it("falls to LINT when the primary AND the typecheck both fail there", async () => {
    const run = vi.fn(async (_d: string, command: string) => (command === LINT.command ? pass() : fail()));
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES, LINT]), run: run as unknown as GuardDeps["run"] });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);
    expect(base.resolved).toEqual(LINT);
    expect(out.rung).toBe("lint");
    expect(out.verdict).toBe("verified");
    expect(out.note).toContain("`npm run lint` ONLY");
  });

  it("reports BASELINE-UNAVAILABLE when no rung passes — the verdict still written about the PRIMARY", async () => {
    const run = vi.fn(async () => fail());
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES, LINT]), run: run as unknown as GuardDeps["run"] });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("baseline-unavailable");
    expect(out.reject).toBe(false);
    expect(out.command).toBe(CMD.command);
    expect(out.rung).toBe("primary");
    // Every sentence the pre-ladder verdict carried survives…
    expect(out.note).toContain("did not pass on the pristine lane worktree");
    expect(out.note).toContain("NOT evidence that the repository's own checks fail elsewhere");
    expect(out.note).toContain("controls.ciHardPass");
    // …plus the fact that the ladder was walked, placed BEFORE the `First failure:` marker so it is
    // never quoted back to an operator as the repository's own output (`baselineFailureLines`).
    expect(out.note).toContain("Narrower hermetic checks were tried");
    expect(out.note.indexOf("Narrower hermetic")).toBeLessThan(out.note.indexOf("First failure:"));
    expect(out.note.split("First failure:")[1]).toContain("AssertionError");
  });

  it("REJECTS a narrowed pass→fail exactly as strictly, and discards the worktree edits", async () => {
    // Baseline: primary fails, typecheck passes. Result: the same typecheck now fails.
    const run = vi
      .fn()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(pass())
      .mockResolvedValueOnce(fail());
    const discard = vi.fn(async () => true);
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES]), run: run as unknown as GuardDeps["run"], discard });

    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d);

    expect(out.verdict).toBe("rejected");
    expect(out.reject).toBe(true);
    expect(out.rung).toBe("typecheck");
    expect(discard).toHaveBeenCalledWith(DIR);
    expect(out.note).toContain("a NARROWED typecheck check");
    expect(out.note).toContain("npm run check:ci");
  });

  it("re-runs the rung that ESTABLISHED the baseline, never the primary — A and B are one question", async () => {
    const run = vi.fn(async (_d: string, command: string) => (command === CMD.command ? fail() : pass()));
    const d = deps({ resolveLadder: vi.fn(async () => [CMD, TYPES]), run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    await verifyResult(DIR, base, MS, d);
    expect(run.mock.calls.map((c) => c[1])).toEqual([CMD.command, TYPES.command, TYPES.command]);
  });
});
