import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { excludeLaneReport } from "./lane-report-exclude";
import { LANE_REPORT_PATH } from "./lane-report";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error("Unexpected fixture parent");
    rmSync(root, { recursive: true, force: true });
  }
});
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  expect(result.error).toBeUndefined();
  return result;
}
function checked(cwd: string, ...args: string[]) {
  const result = git(cwd, ...args);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

it.each([false, true].flatMap((linked) => ["plain", "comment", "negated"].map((rule) => [linked, rule] as const)))(
  "excludes the lane report from actual Git staging (linked=%s, rule=%s)", async (linked, rule) => {
  const root = mkdtempSync(join(tmpdir(), "ascent-report-exclude-"));
  roots.push(root);
  const main = join(root, "main");
  mkdirSync(main);
  checked(main, "init", "--quiet");
  writeFileSync(join(root, "empty-excludes"), "");
  checked(main, "config", "core.excludesFile", join(root, "empty-excludes"));
  checked(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--allow-empty", "-m", "fixture");
  const cwd = linked ? join(root, "linked") : main;
  if (linked) checked(main, "worktree", "add", "--quiet", "--detach", cwd);
  mkdirSync(join(cwd, ".ascent"));
  writeFileSync(join(cwd, LANE_REPORT_PATH), '{"v":1}');
  writeFileSync(join(cwd, "deliverable.txt"), "keep this change\n");
  const exclude = checked(cwd, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
  const original = "# unrelated existing rule\n*.scratch\n" + (rule === "comment"
    ? `# Keep ${LANE_REPORT_PATH} out of commits\n`
    : rule === "negated" ? `${LANE_REPORT_PATH}\n!${LANE_REPORT_PATH}\n` : "");
  writeFileSync(exclude, original);
  expect(git(cwd, "check-ignore", "--quiet", LANE_REPORT_PATH).status).toBe(1);
  await excludeLaneReport(cwd);
  expect(git(cwd, "check-ignore", "--quiet", LANE_REPORT_PATH).status).toBe(0);
  expect(readFileSync(exclude, "utf8")).toBe(original + LANE_REPORT_PATH + "\n");
  await excludeLaneReport(cwd);
  expect(readFileSync(exclude, "utf8")).toBe(original + LANE_REPORT_PATH + "\n");
  checked(cwd, "add", "-A");
  expect(checked(cwd, "diff", "--cached", "--name-only")).toBe("deliverable.txt");
});
