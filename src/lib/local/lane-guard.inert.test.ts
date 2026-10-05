// VERIFIED BY CONSTRUCTION — the guard's upgrade for a diff no check reads (`lane-inert.ts`).
//
// Only `skipped` and `baseline-unavailable` may be upgraded, and only when EVERY changed path is inert.
// A passing baseline is still re-run, so `rejected` is never reachable by this path. Every case below
// pins one half of that sentence.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local/git", () => ({ runGit: vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })) }));

import { __clearVerifyBaselines, verifyBaseline, verifyResult, type GuardDeps, type VerifyRun } from "@/lib/local/lane-guard";
import type { ResolvedVerify } from "@/lib/local/lane-verify";

const CMD: ResolvedVerify = { command: "npm run check:ci", source: ".ai/manifest.yaml (ciHardPass)", rung: "primary" };
const DIR = "C:/tmp/wt-inert";
const MS = 600_000;
const INERT = ["README.md", ".github/pull_request_template.md", "docs/AI_HARNESS.md", ".ai/manifest.yaml"];

const pass = (): VerifyRun => ({ ok: true, output: "ok", timedOut: false });
const fail = (): VerifyRun => ({ ok: false, output: "FAIL src/a.test.ts\nAssertionError: expected 1 to be 2", timedOut: false });

const deps = (over: Partial<GuardDeps> = {}): Partial<GuardDeps> => ({
  resolveLadder: vi.fn(async () => [CMD]),
  run: vi.fn(async () => pass()),
  discard: vi.fn(async () => true),
  ...over,
});

beforeEach(() => __clearVerifyBaselines());

describe("a guard that could not run, over an all-inert diff", () => {
  it("SKIPPED + inert → verified by construction, saying the checks were NOT run and why", async () => {
    const d = deps({ resolveLadder: vi.fn(async () => []) });
    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d, INERT);
    expect(out).toMatchObject({ verdict: "verified", reject: false, command: null, rung: null });
    expect(out.note.startsWith("Verified by construction:")).toBe(true);
    expect(out.note).toContain("`README.md`");
    expect(out.note).toContain("NOT run");
    expect(out.note).toContain("declares no check");
  });

  it("BASELINE-UNAVAILABLE + inert → verified, naming the command that had no baseline — and runs nothing more", async () => {
    const run = vi.fn(async () => fail());
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const base = await verifyBaseline(DIR, MS, d);
    const out = await verifyResult(DIR, base, MS, d, INERT);
    expect(out).toMatchObject({ verdict: "verified", reject: false, command: null, rung: null });
    expect(out.note.startsWith("Verified by construction:")).toBe(true);
    expect(out.note).toContain("npm run check:ci");
    expect(out.note).toContain("no baseline");
    expect(run).toHaveBeenCalledTimes(1); // the baseline only
  });

  it("names five paths, then counts the rest", async () => {
    const many = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"];
    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, deps({ resolveLadder: vi.fn(async () => []) })), MS, {}, many);
    expect(out.note).toContain("`e.md`");
    expect(out.note).not.toContain("`f.md`");
    expect(out.note).toContain("+2 more");
  });
});

describe("what is NOT upgraded", () => {
  it("SKIPPED + one non-inert path → still skipped", async () => {
    const d = deps({ resolveLadder: vi.fn(async () => []) });
    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d, [...INERT, ".github/workflows/ci.yml"]);
    expect(out.verdict).toBe("skipped");
    expect(out.note).toContain("UNVERIFIED");
  });

  it("BASELINE-UNAVAILABLE + one non-inert path → still baseline-unavailable", async () => {
    const d = deps({ run: vi.fn(async () => fail()) as unknown as GuardDeps["run"] });
    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d, ["README.md", "src/index.ts"]);
    expect(out.verdict).toBe("baseline-unavailable");
  });

  it("an empty or absent diff changes nothing — both verdicts are what they were", async () => {
    const none = deps({ resolveLadder: vi.fn(async () => []) });
    const base = await verifyBaseline(DIR, MS, none);
    expect((await verifyResult(DIR, base, MS, none)).verdict).toBe("skipped");
    expect((await verifyResult(DIR, base, MS, none, [])).verdict).toBe("skipped");
  });

  it("a PASSING baseline still re-runs its command, inert diff or not", async () => {
    const run = vi.fn(async () => pass());
    const d = deps({ run: run as unknown as GuardDeps["run"] });
    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d, INERT);
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.verdict).toBe("verified");
    expect(out.command).toBe(CMD.command);
    expect(out.note.startsWith("Verified: ")).toBe(true);
  });

  it("REJECTED is never upgraded: pass → fail over an all-inert diff is still a rejection, and still discards", async () => {
    const discard = vi.fn(async () => true);
    const run = vi.fn().mockResolvedValueOnce(pass()).mockResolvedValueOnce(fail());
    const d = deps({ run: run as unknown as GuardDeps["run"], discard });
    const out = await verifyResult(DIR, await verifyBaseline(DIR, MS, d), MS, d, INERT);
    expect(out.verdict).toBe("rejected");
    expect(out.reject).toBe(true);
    expect(discard).toHaveBeenCalledWith(DIR);
  });
});
