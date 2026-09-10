import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { runGit } from "@/lib/local/git";
import { LANE_REPORT_PATH } from "./lane-report";

/**
 * Keep `.ascent/lane-report.json` out of the deliverable.
 *
 * The report is a channel between the session and Ascent, not an artifact of the work, and the branch
 * IS the deliverable a human reviews. `.git/info/exclude` rather than `.gitignore`: a `.gitignore`
 * edit is itself a change to the repository, and the lane would then be committing a file the
 * operator never asked for into every branch it produces. `info/exclude` is local Git metadata,
 * shared by linked worktrees. Ask Git for its effective location instead of appending to a private
 * worktree Git directory, whose `info/exclude` Git does not read.
 *
 * Best-effort: a failure here means the file might be committed if the agent runs `git add -A`, which
 * `--permission-mode acceptEdits` does not let it do anyway. It is the belt, not the braces.
 */
export async function excludeLaneReport(dir: string): Promise<void> {
  try {
    const res = await runGit(dir, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
    const file = res.stdout.trim();
    // ABSOLUTE OR NOTHING. `--path-format=absolute` requests one; anything else means git did not answer
    // the question we asked (a stub, a shim, an older git), and joining a relative fragment onto the
    // process's cwd would create `./<fragment>/info/exclude` somewhere nobody asked for a directory.
    // Found by this repo's own suite: mocked git stdout produced stray `sha/`, `headsha/` folders at
    // the worktree root.
    if (!res.ok || !file || !isAbsolute(file)) return;
    await mkdir(dirname(file), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch {
      existing = "";
    }
    // A mention in a comment is not a rule, and an earlier rule may have been negated later.
    const rules = existing.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (rules.at(-1) === LANE_REPORT_PATH) return;
    await writeFile(file, `${existing}${existing.endsWith("\n") || existing === "" ? "" : "\n"}${LANE_REPORT_PATH}\n`, "utf8");
  } catch {
    /* the report contract also tells the agent not to commit it; this is the second belt */
  }
}

