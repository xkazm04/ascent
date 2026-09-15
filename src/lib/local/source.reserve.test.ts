// The reserved byte budget of the local source — the wave-2 comparability defect. `pickFilesToFetch`
// appends workflows LAST (a file-count reserve), so a sequential read that stops at MAX_TOTAL_BYTES
// never reached them on a worktree with enough large samples, and the loop's rescan scored "0/1
// workflows" against a before-scan that had read all of them.

import { describe, expect, it } from "vitest";
import { RESERVED_PICK_RE, readPicksWithReserve } from "@/lib/local/source";
import { pickFilesToFetch } from "@/lib/github/source";
import type { RepoFile } from "@/lib/types";

const big = "x".repeat(14_000); // one file at the per-file cap; 50 of them is 700 KB, 2.5× the budget

const worktree = (): Record<string, string> => {
  const fs: Record<string, string> = { "README.md": "# repo", "package.json": "{}" };
  for (let i = 0; i < 50; i++) fs[`src/mod${i}/index.ts`] = big;
  for (let i = 0; i < 50; i++) fs[`src/mod${i}/index.test.ts`] = big;
  fs[".github/workflows/ci.yml"] = "permissions:\n  contents: read\n";
  fs[".github/workflows/release.yml"] = "permissions:\n  contents: read\n";
  fs[".github/workflows/codeql.yml"] = "uses: github/codeql-action/analyze@v3\n";
  fs[".github/dependabot.yml"] = "version: 2";
  fs["SECURITY.md"] = "report here";
  fs["CLAUDE.md"] = "guidance";
  return fs;
};

describe("readPicksWithReserve", () => {
  it("fetches every workflow (and the other reserved picks) on a worktree whose samples exhaust the byte budget", async () => {
    const fs = worktree();
    const tree: RepoFile[] = Object.keys(fs).map((path) => ({ path, type: "blob" as const }));
    const picks = pickFilesToFetch(tree);
    expect(picks.filter((p) => p.startsWith(".github/workflows/"))).toHaveLength(3);

    const files = await readPicksWithReserve(picks, async (p) => fs[p] ?? null);
    const got = new Set(files.map((f) => f.path));
    for (const w of [".github/workflows/ci.yml", ".github/workflows/release.yml", ".github/workflows/codeql.yml"]) expect(got.has(w)).toBe(true);
    expect(got.has(".github/dependabot.yml")).toBe(true);
    expect(got.has("SECURITY.md")).toBe(true);
    expect(got.has("CLAUDE.md")).toBe(true);

    // The budget still binds the UNRESERVED picks: not every large sample was read.
    const unreserved = files.filter((f) => !RESERVED_PICK_RE.test(f.path));
    expect(unreserved.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(280_000 + 14_000);
    // …and the result is in pick order, so the prompt window is what it always was.
    const idx = new Map(picks.map((p, i) => [p, i]));
    for (let i = 1; i < files.length; i++) expect(idx.get(files[i]!.path)!).toBeGreaterThan(idx.get(files[i - 1]!.path)!);
  });

  it("names exactly the reserved class", () => {
    for (const p of [".github/workflows/ci.yml", ".github/dependabot.yml", "renovate.json", ".renovaterc", "SECURITY.md", ".ai/manifest.yaml", ".ai/memory/0001-x.md", "CLAUDE.md", "AGENTS.md"]) {
      expect(RESERVED_PICK_RE.test(p), p).toBe(true);
    }
    for (const p of ["README.md", "src/index.ts", "docs/security.md", ".github/CODEOWNERS"]) expect(RESERVED_PICK_RE.test(p), p).toBe(false);
  });
});
