// The install lane against a target that gitignores part of what it generates — the real failure
// (a repo ignoring `.claude/skills` because its skills are local links) that used to kill the whole
// lane at `git add`. Real fs + real git for the same reason as lane-install.test.ts: "what landed in
// the commit" is the claim, and only a real index can answer it. Only the DB reads are faked.

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

function makeReport(): ScanReport {
  return {
    repo: {
      owner: "acme", name: "api", url: "https://github.com/acme/api", description: "Billing API",
      stars: 12, forks: 1, primaryLanguage: "TypeScript", defaultBranch: "main", headSha: "abc1234",
    },
    overallScore: 58, level: levelForScore(58), archetype: "team",
    adoptionScore: 55, rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "x" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [], dimensions: [],
    headline: "h", strengths: [], risks: [], roadmap: [], discrepancies: [],
    confidence: 0.8, scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

vi.mock("@/lib/db", () => ({ getScanReportByCommit: vi.fn(async () => makeReport()) }));
vi.mock("@/lib/db/org-practice-shapes", () => ({ getOrgPracticeShapes: vi.fn(async () => null) }));

import { installInWorktree } from "./lane-install";
import { buildFoundation } from "@/lib/standard";

const SKILL = ".claude/skills/ascent-onboard/SKILL.md";
const dirs: string[] = [];

function gitRepo(gitignore: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-lane-ignored-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "loop@ascent.test");
  git("config", "user.name", "Ascent Loop");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n", "utf8");
  writeFileSync(join(dir, ".gitignore"), gitignore, "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

const sh = (dir: string, ...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const committedFiles = (dir: string): string[] => sh(dir, "show", "--name-only", "--format=", "HEAD").split(/\r?\n/).filter(Boolean);

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("installInWorktree — paths the target repository gitignores", () => {
  it("commits around the ignored file, never forces it, and names it", async () => {
    const dir = gitRepo(".claude/skills\n");
    const generated = buildFoundation(makeReport()).map((f) => f.path);
    expect(generated).toContain(SKILL); // the premise: the foundation does write into the ignored dir

    const res = await installInWorktree({ dir, org: "acme", repo: "acme/api", kind: "foundation" });

    expect(res.ok).toBe(true);
    expect(res.committed).toBe(true);
    expect(res.ignored).toEqual([SKILL]);
    expect(res.written).not.toContain(SKILL);
    expect(res.written.length).toBe(generated.length - 1);
    // The commit is exactly `written` — the ignored file was neither staged nor forced.
    expect(committedFiles(dir).sort()).toEqual([...res.written].sort());
    // Removed again, empty parents with it: ignored residue in a lane worktree is pointless.
    expect(existsSync(join(dir, SKILL))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(res.summary).toContain(`skipped 1 the repository's .gitignore excludes: ${SKILL}`);
    expect(sh(dir, "log", "-1", "--format=%B")).toContain(`the repository's .gitignore excludes: ${SKILL}`);
  });

  it("reports an install whose every file is ignored as written-nothing, not as a failure", async () => {
    const dir = gitRepo("AGENTS.md\n");
    const before = sh(dir, "rev-parse", "HEAD");

    const res = await installInWorktree({ dir, org: "acme", repo: "acme/api", kind: "practice", practiceId: "agent-guidance" });

    expect(res.ok).toBe(true);
    expect(res.committed).toBe(false);
    expect(res.written).toEqual([]);
    expect(res.ignored).toEqual(["AGENTS.md"]);
    expect(res.summary).toMatch(/^Nothing to commit — skipped 1 the repository's \.gitignore excludes: AGENTS\.md/);
    expect(sh(dir, "rev-parse", "HEAD")).toBe(before);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("leaves `ignored` off entirely when nothing was ignored", async () => {
    const dir = gitRepo("node_modules\n");
    const res = await installInWorktree({ dir, org: "acme", repo: "acme/api", kind: "practice", practiceId: "agent-guidance" });
    expect(res.committed).toBe(true);
    expect(res.written).toEqual(["AGENTS.md"]);
    expect(res).not.toHaveProperty("ignored");
    expect(res.summary).toBe("Installed 1 file(s).");
  });
});
