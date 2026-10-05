// THE TWO DECLARATION MOVES THE GUARD CLEARS ON EVIDENCE (2026-10-05) — and every weakening path
// beside them that must still void. Both shapes are the measured cases: garden-vr ADDED a guard script
// no ladder runs; firetv DECLARED the repository's real gate while being measured with the old one.

import { describe, expect, it } from "vitest";
import { checkGateDiff, type GateDiffOptions, type LadderRung } from "@/lib/local/lane-gate-diff";
import { bootstrapVerifyNote, declaredGateCommands, gateChangeSentence, isVacuousCommand, rungReferencing } from "@/lib/local/lane-gate-diff-declare";

const A = (path: string) => ({ path, status: "A" });
const M = (path: string) => ({ path, status: "M" });
const rungs = (...commands: string[]): LadderRung[] =>
  commands.map((command, i) => ({ command, rung: i === 0 ? ("primary" as const) : ("typecheck" as const) }));
const same = (...commands: string[]) => ({ before: rungs(...commands), after: rungs(...commands) });

describe("A — an ADDED gate script is judged against the ladder that would run it", () => {
  it("garden-vr: an added tools/guard/check.mjs that `dotnet test x` never runs is NOT void", () => {
    const v = checkGateDiff([A("tools/guard/check.mjs"), A("src/Game.cs")], { verifyLadder: same("dotnet test shared/core-dotnet") });
    expect(v).toEqual({ void: false, reason: null, paths: [] });
  });

  it("an added scripts/verify.mjs that the ladder runs (`node scripts/verify.mjs`) is void", () => {
    const v = checkGateDiff([A("scripts/verify.mjs")], { verifyLadder: same("node scripts/verify.mjs") });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("`node scripts/verify.mjs` runs it");
  });

  it("a reference on EITHER side voids — the after ladder counts as much as the before", () => {
    const v = checkGateDiff([A("tools/check.mjs")], { verifyLadder: { before: rungs("npm test"), after: rungs("node tools/check") } });
    expect(v.void).toBe(true);
  });

  it("a modified gate script NO ladder runs is cleared — editing it cannot flatter the verdict", () => {
    // Measured 2026-10-05: a lane refining the pre-commit guard an earlier lane added was voided.
    const v = checkGateDiff([M("tools/check.mjs")], { verifyLadder: same("dotnet test x") });
    expect(v.void).toBe(false);
  });

  it("a modified gate script the ladder RUNS still voids, and so does one with no ladder evidence", () => {
    const run = checkGateDiff([M("tools/check.mjs")], { verifyLadder: same("node tools/check.mjs") });
    expect(run.void).toBe(true);
    expect(run.reason).toContain("verify-command, modified");
    expect(checkGateDiff([M("tools/check.mjs")]).void).toBe(true);
  });

  it("an added gate script with no ladder evidence is void (strict)", () => {
    const v = checkGateDiff([A("tools/guard/check.mjs")]);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("could not be read");
  });

  it.each([
    ["tools/guard/check.mjs", "npm run check", true],
    ["tools/guard/check.mjs", "node .\\tools\\guard\\check.mjs", true],
    ["tools/guard/check.mjs", "node tools/guard/check", true],
    ["scripts/lint.sh", "npm run lint:ci", true],
    ["tools/guard/check.mjs", "dotnet test shared/core-dotnet", false],
    ["tools/guard/check.mjs", "git checkout && npm test", false],
  ])("rungReferencing(%s) in `%s` -> %s", (path, command, hit) => {
    expect(rungReferencing(path, [rungs(command)]) !== null).toBe(hit);
  });
});

/** The firetv shape: a detected gradle check, then the real gates declared in guidance + manifest. */
const FIRETV = {
  before: rungs(".\\gradlew.bat :core:test --console=plain --no-daemon"),
  after: rungs("node tools/gradlew.cjs :core:test", "npm --prefix desk run test:types"),
};
const verified = (command: string) => ({ verdict: "verified", command });
const passed = (command: string, rung: LadderRung["rung"] = "primary") => [{ command, rung, ok: true, timedOut: false }];
const failed = (command: string, timedOut = false) => [{ command, rung: "primary" as const, ok: false, timedOut }];

describe("B — a CHANGED declared gate is cleared only on the evidence", () => {
  it("firetv: measured with the old command, new one passes -> NOT void, and the change is carried", () => {
    const v = checkGateDiff([M("AGENTS.md"), A(".ai/manifest.yaml"), M("CONTRIBUTING.md")], {
      verifyLadder: FIRETV,
      laneVerdict: verified(FIRETV.before[0]!.command),
      declaredGateRuns: passed("node tools/gradlew.cjs :core:test"),
    });
    expect(v.void).toBe(false);
    expect(v.gateChange).toEqual({
      from: ".\\gradlew.bat :core:test --console=plain --no-daemon",
      to: "node tools/gradlew.cjs :core:test",
      passed: "node tools/gradlew.cjs :core:test",
      rung: "primary",
      files: ["AGENTS.md", ".ai/manifest.yaml", "CONTRIBUTING.md"],
      measured: "verified",
    });
    const line = gateChangeSentence(v.gateChange!);
    expect(line).toContain("Gate changed: `.\\gradlew.bat :core:test --console=plain --no-daemon` -> `node tools/gradlew.cjs :core:test`");
    expect(line).toContain("declared in AGENTS.md, .ai/manifest.yaml, CONTRIBUTING.md");
    expect(line).toContain("review it when merging the runner branch");
  });

  it("a lane with no baseline on the old command (the guard's own advice followed) is cleared, said so", () => {
    const v = checkGateDiff([M("AGENTS.md")], {
      verifyLadder: FIRETV,
      laneVerdict: { verdict: "baseline-unavailable", command: FIRETV.before[0]!.command },
      declaredGateRuns: passed(FIRETV.after[0]!.command),
    });
    expect(v.gateChange?.measured).toBe("baseline-unavailable");
    expect(gateChangeSentence(v.gateChange!)).toContain("established no baseline on its worktree");
  });

  const base: GateDiffOptions = {
    verifyLadder: { before: rungs("npm test"), after: rungs("npm run test:all") },
    laneVerdict: verified("npm test"),
    declaredGateRuns: passed("npm run test:all"),
  };
  it.each<[string, GateDiffOptions, string]>([
    ["the new gate fails", { ...base, declaredGateRuns: failed("npm run test:all") }, "does not pass here"],
    ["the new gate times out", { ...base, declaredGateRuns: failed("npm run test:all", true) }, "timed out"],
    ["the new gate was never run", { ...base, declaredGateRuns: null }, "was not run"],
    ["a run of some other command", { ...base, declaredGateRuns: passed("npm test") }, "was not run"],
    ["the verdict ran another command", { ...base, laneVerdict: verified("npm run lint") }, "not reached with `npm test`"],
    ["a narrowed verdict", { ...base, laneVerdict: verified("npx tsc --noEmit") }, "not reached with `npm test`"],
    ["no verdict at all (guard off)", { ...base, laneVerdict: null }, "not reached with `npm test`"],
    ["verified by construction (nothing ran)", { ...base, laneVerdict: { verdict: "verified", command: null } }, "not reached"],
    ["a skipped verdict", { ...base, laneVerdict: { verdict: "skipped", command: "npm test" } }, "not reached"],
    ["the new gate is `echo ok`", { ...base, verifyLadder: { before: rungs("npm test"), after: rungs("echo ok") }, declaredGateRuns: passed("echo ok") }, "checks nothing"],
    ["the gate is removed", { ...base, verifyLadder: { before: rungs("npm test"), after: [] } }, "leaves no verify command"],
    ["only a fallback rung changed", { ...base, verifyLadder: { before: rungs("npm test", "npm run tc"), after: rungs("npm test", "npm run tc2") } }, "narrower fallbacks"],
  ])("void when %s", (_label, opts, why) => {
    const v = checkGateDiff([M("AGENTS.md")], opts);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("`npm test`");
    expect(v.reason).toContain(why);
    expect(v.gateChange).toBeUndefined();
  });

  it("a cleared gate change does not clear anything else: a modified test still voids, with no gateChange", () => {
    const v = checkGateDiff([M("AGENTS.md"), M("src/app.test.ts")], base);
    expect(v.void).toBe(true);
    expect(v.paths).toEqual(["src/app.test.ts"]);
    expect(v.gateChange).toBeUndefined();
  });

  it("a package.json change beside the declaration still voids — a script body can move", () => {
    expect(checkGateDiff([M("AGENTS.md"), M("package.json")], base).void).toBe(true);
  });

  it("declaredGateCommands names the command to run only when nothing refuses it first", () => {
    expect(declaredGateCommands(base.verifyLadder!, verified("npm test"))).toEqual([{ command: "npm run test:all", rung: "primary" }]);
    expect(declaredGateCommands(base.verifyLadder!, verified("npm run lint"))).toEqual([]);
    expect(declaredGateCommands({ before: rungs("npm test"), after: rungs("true && echo x") }, verified("npm test"))).toEqual([]);
  });
});

/** The mage-arena shape: an Unreal repo with no resolvable check declares its first gate. */
const MAGE = {
  before: [] as LadderRung[],
  after: [
    { command: "node apps/vr/tools/lint.mjs && node apps/vr/tools/check-pin.mjs && gitleaks git --redact --no-banner", rung: "primary" as const },
    { command: "node apps/vr/tools/lint.mjs", rung: "lint" as const },
  ],
};
const skipped = { verdict: "skipped", command: null };

describe("D — a BOOTSTRAP (no gate -> a gate) is cleared when the first gate passes", () => {
  it("mage-arena: the primary needs a missing tool, the lint rung passes -> NOT void, naming the rung that passed", () => {
    const runs = [
      { ...MAGE.after[0]!, ok: false, timedOut: false },
      { ...MAGE.after[1]!, ok: true, timedOut: false },
    ];
    const v = checkGateDiff([A(".ai/manifest.yaml"), M("CONTRIBUTING.md")], { verifyLadder: MAGE, laneVerdict: skipped, declaredGateRuns: runs });
    expect(v.void).toBe(false);
    expect(v.gateChange).toMatchObject({ from: null, to: MAGE.after[0]!.command, passed: "node apps/vr/tools/lint.mjs", rung: "lint", measured: "bootstrap" });
    expect(v.gateChange!.files).toEqual([".ai/manifest.yaml", "CONTRIBUTING.md"]);
    expect(gateChangeSentence(v.gateChange!)).toContain("FIRST verify gate");
    expect(gateChangeSentence(v.gateChange!)).toContain("its lint rung `node apps/vr/tools/lint.mjs` did");
    expect(bootstrapVerifyNote(v.gateChange!)).toMatch(/^Verified against the gate this lane DECLARED \(bootstrap\):/);
    expect(bootstrapVerifyNote(v.gateChange!)).toContain("no prior gate");
  });

  it("asks the loader for every non-vacuous rung, primary first", () => {
    expect(declaredGateCommands(MAGE, skipped).map((r) => r.rung)).toEqual(["primary", "lint"]);
  });

  it("void when no rung passes, naming each failure", () => {
    const runs = MAGE.after.map((r) => ({ ...r, ok: false, timedOut: false }));
    const v = checkGateDiff([A(".ai/manifest.yaml")], { verifyLadder: MAGE, laneVerdict: skipped, declaredGateRuns: runs });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("(none resolved) -> ");
    expect(v.reason).toContain("does not pass here");
    expect(v.reason).toContain("`node apps/vr/tools/lint.mjs` failed");
  });

  it.each<[string, GateDiffOptions, string]>([
    ["the first gate is vacuous", { verifyLadder: { before: [], after: rungs("echo ok") }, laneVerdict: skipped, declaredGateRuns: passed("echo ok") }, "checks nothing"],
    ["the guard was off (no verdict) — nothing is run", { verifyLadder: MAGE, laneVerdict: null, declaredGateRuns: passed("node apps/vr/tools/lint.mjs", "lint") }, "not the no-check one"],
    ["the verdict measured a command (it had a gate)", { verifyLadder: MAGE, laneVerdict: verified("npm test"), declaredGateRuns: passed(MAGE.after[0]!.command) }, "not the no-check one"],
    ["nothing was run", { verifyLadder: MAGE, laneVerdict: skipped }, "was not run"],
  ])("void when %s", (_label, opts, why) => {
    const v = checkGateDiff([A(".ai/manifest.yaml")], opts);
    expect(v.void).toBe(true);
    expect(v.reason).toContain(why);
    expect(v.gateChange).toBeUndefined();
  });

  it("a vacuous primary is refused even when a real narrower rung exists", () => {
    const ladder = { before: [], after: [{ command: "echo ok", rung: "primary" as const }, { command: "npm run lint", rung: "lint" as const }] };
    expect(declaredGateCommands(ladder, skipped)).toEqual([]);
  });
});

describe("isVacuousCommand", () => {
  it.each(["echo ok", "true", "exit 0", ":", "rem nothing", "cd src", "ls", "dir", "echo a && true", "@echo off & exit 0", ""])("`%s` is vacuous", (c) => {
    expect(isVacuousCommand(c)).toBe(true);
  });
  it.each(["npm test", "cd desk && npm test", "dotnet test x", "node tools/gradlew.cjs :core:test", "echo start; pytest -q"])("`%s` is not", (c) => {
    expect(isVacuousCommand(c)).toBe(false);
  });
});
