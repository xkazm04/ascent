import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest.config.js deletes the repo-locating variables a git hook exports. Without that, a fixture's
// `git -C <scratch>` under the pre-push hook acts on the real repository (see the comment there).
describe("the suite runs without an inherited git repository", () => {
  it("no repo-locating variable reaches a test", () => {
    for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
      expect(process.env[k], k).toBeUndefined();
    }
  });

  it("a spawned git resolves the scratch repo it was pointed at", () => {
    const dir = mkdtempSync(join(tmpdir(), "ascent-git-env-"));
    try {
      execFileSync("git", ["init", "-q", dir]);
      const gitDir = execFileSync("git", ["-C", dir, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" });
      expect(gitDir).toContain("ascent-git-env-");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
