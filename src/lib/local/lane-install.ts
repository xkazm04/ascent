// The DETERMINISTIC lane body: generate, write into the worktree, commit. No agent, no LLM, no
// network — the whole reason these two kinds are worth having as lanes at all.
//
// Both kinds go through the SAME generator the cloud draft-PR doors use:
//   • foundation → `buildFoundation` (@/lib/standard), the exact array `/api/report/foundation/pr`
//     hands to `openFoundationPr`;
//   • practice   → `buildPracticeArtifact` (@/lib/practices/artifact), the exact call
//     `applyPracticeToRepo` makes for `/api/practices/apply{,-batch}`.
// Only DELIVERY differs (a write into a git worktree instead of a contents-API commit), which is the
// split the two install modules exist to keep honest — see `install-files.ts` for the collision
// policy, copied from `openDraftPr` rather than relaxed.
//
// Both kinds need a PERSISTED SCAN, for the same reason the foundation PR route 404s without one:
// the generated manifest is built out of the repo's commands, archetype and freshness anchors, and a
// practice starter is tailored to its language. A repo with no scan has nothing to install.

import { rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runGit } from "@/lib/local/git";
import { installFiles } from "@/lib/local/install-files";
import { getScanReportByCommit } from "@/lib/db";
import { buildFoundation } from "@/lib/standard";
import { buildPracticeArtifact } from "@/lib/practices/artifact";
import { FOLLOWUP_TRAILER } from "@/lib/org/followups";
import type { ScanReport } from "@/lib/types";

export interface LaneInstallInput {
  /** The worktree to write into — never the operator's own checkout. */
  dir: string;
  org: string;
  /** "owner/name". */
  repo: string;
  kind: "foundation" | "practice";
  /** Required for `practice`. */
  practiceId?: string | null;
  /** The follow-up id this install claims to resolve; becomes the commit's `Ascent-Resolves:` trailer. */
  resolvesId?: string | null;
}

export interface LaneInstallResult {
  ok: boolean;
  /** Repo-relative paths this install COMMITTED — never one it wrote and then could not stage. */
  written: string[];
  /** Paths the repository already had, so the install left its own copy alone. */
  skipped: string[];
  /** Paths generated but excluded by the repository's own `.gitignore` — not committed, and removed
   *  from the worktree again. Absent when none were. */
  ignored?: string[];
  /** True when a commit actually landed. False for "nothing to write" as well as for a failure. */
  committed: boolean;
  /** One line for the lane log — the reason, whichever way it went. */
  summary: string;
}

/** The practice generator's repo context, taken from the persisted scan instead of the GitHub API. */
function contextFromReport(report: ScanReport) {
  const { repo } = report;
  return {
    fullName: `${repo.owner}/${repo.name}`,
    name: repo.name,
    description: repo.description ?? null,
    primaryLanguage: repo.primaryLanguage ?? null,
    defaultBranch: repo.defaultBranch,
  };
}

const FOUNDATION_BODY = [
  "Installs the `.ai/` foundation Ascent generated from this repository's latest scan: the",
  "agent-facing contract (`.ai/manifest.yaml`), the executable conformance check (`.ai/doctor.mjs`)",
  "and its CI backstop, the upkeep script, the durable memory store, and the CONTEXT graph seed.",
  "",
  "How a reviewer tells this is real: `node .ai/doctor.mjs` runs and reports conformance, and the",
  "generated workflow runs it on every push. It fails when a declared capability's command does not",
  "exist or does not pass. Every `TODO` still needs adapting to this repo.",
  "",
  "Written by the improvement loop's foundation lane — the same generator behind the",
  "\"Install .ai/ foundation\" draft PR, delivered into this worktree instead of onto a branch.",
].join("\n");

/**
 * Which of `paths` the repository ignores, or `null` when git could not say.
 *
 * `check-ignore` exits 0 with the ignored paths on stdout, 1 with nothing when none are, and 128 on a
 * fatal error. `runGit` folds every non-zero exit into `ok:false`, so the two are told apart by
 * git's own output: exit 1 is silent, a fatal always says `fatal:` on stderr (as does the wrapper's
 * own timeout). A line that is not one of `paths` (a quoted name) also returns `null` — the caller
 * then stages everything as before rather than act on a reading it does not understand.
 */
async function ignoredPaths(dir: string, paths: string[]): Promise<string[] | null> {
  const res = await runGit(dir, ["check-ignore", "--", ...paths]);
  if (!res.ok) return res.stdout.trim() === "" && res.stderr.trim() === "" ? [] : null;
  const asked = new Set(paths);
  const lines = res.stdout.split(/\r?\n/).filter(Boolean);
  return lines.every((l) => asked.has(l)) ? lines : null;
}

/**
 * Take the files this install wrote but may not commit back out of the worktree, with any directory
 * that leaves empty. Safe because `installFiles` never writes over an existing file — every path here
 * was created by this call. Best-effort: ignored residue is pointless, not harmful.
 */
async function removeInstalled(dir: string, paths: string[]): Promise<void> {
  const root = resolve(dir);
  for (const rel of paths) {
    await rm(join(root, rel), { force: true }).catch(() => undefined);
    for (let d = dirname(resolve(root, rel)); d.startsWith(root) && d !== root; d = dirname(d)) {
      if (!(await rmdir(d).then(() => true, () => false))) break; // non-empty (or gone): stop climbing
    }
  }
}

/**
 * Produce, write and commit one install in `dir`. Never throws: every outcome is lane data, exactly
 * like the agent path, so a repo that cannot be installed does not take its run's siblings with it.
 */
export async function installInWorktree(input: LaneInstallInput): Promise<LaneInstallResult> {
  const fail = (summary: string): LaneInstallResult => ({ ok: false, written: [], skipped: [], committed: false, summary });
  const [owner, name] = input.repo.split("/");
  if (!owner || !name) return fail(`Not a repository name: ${input.repo}`);

  const report = await getScanReportByCommit(owner, name, { orgSlug: input.org }).catch(() => null);
  if (!report) return fail("No saved scan for this repository yet — nothing to generate an install from.");

  let files: { path: string; body: string }[];
  let subject: string;
  let body: string;
  let spineGuard = false;

  if (input.kind === "foundation") {
    files = buildFoundation(report);
    spineGuard = true;
    subject = "chore(.ai): install the AI-native foundation";
    body = FOUNDATION_BODY;
  } else {
    const practiceId = input.practiceId?.trim();
    if (!practiceId) return fail("A practice lane needs a practice id.");
    const { artifact } = await buildPracticeArtifact(practiceId, contextFromReport(report), { orgSlug: input.org });
    if (!artifact) return fail(`Unknown practice: ${practiceId}`);
    files = [artifact];
    subject = artifact.commitMessage;
    body = [
      `Seeds the Practice Library starter for \`${practiceId}\` — the same artifact the "Apply practice"`,
      "draft PR would open, written into this worktree instead.",
      "",
      "How a reviewer tells this is real: the file is a scaffold with explicit TODOs, not a claim that",
      "the practice already operates. The rescan below only closes the follow-up if the practice's",
      "dimension measurably moved; a starter nobody adapted will leave the row open.",
    ].join("\n");
  }

  const installed = await installFiles(input.dir, files, { spineGuard });
  if (installed.alreadyInstalled) {
    return { ok: true, written: [], skipped: [], committed: false, summary: "Already installed — the spine is present, so nothing was written." };
  }
  if (installed.written.length === 0) {
    return {
      ok: true,
      written: [],
      skipped: installed.skipped,
      committed: false,
      summary: `Nothing to write — the repository already has ${installed.skipped.length} of these file(s).`,
    };
  }

  // The repo's ignore rules are the repo's decision. A target that gitignores, say, `.claude/skills`
  // (its skills are local links) makes `git add` refuse the WHOLE batch; we stage around the ignored
  // paths instead — never `add -f` over them — and say which they were.
  const ignored = (await ignoredPaths(input.dir, installed.written)) ?? [];
  const toCommit = installed.written.filter((p) => !ignored.includes(p));
  if (ignored.length > 0) await removeInstalled(input.dir, ignored);
  const ignoredNote = ignored.length > 0 ? `skipped ${ignored.length} the repository's .gitignore excludes: ${ignored.join(", ")}` : "";
  const ignoredField = ignored.length > 0 ? { ignored } : {};
  if (toCommit.length === 0) {
    const alsoHad = installed.skipped.length > 0 ? `; the repository already has ${installed.skipped.length} more` : "";
    return { ok: true, written: [], skipped: installed.skipped, ...ignoredField, committed: false, summary: `Nothing to commit — ${ignoredNote}${alsoHad}.` };
  }

  // Stage BY PATH, never `add -A`: a worktree can carry an agent's scratch from an earlier cycle, and
  // a deterministic install must commit exactly what it generated.
  const added = await runGit(input.dir, ["add", "--", ...toCommit]);
  if (!added.ok) return fail(`Could not stage the install: ${added.stderr || added.stdout}`);

  const trailer = input.resolvesId ? `\n\n${FOLLOWUP_TRAILER}: ${input.resolvesId}` : "";
  const skippedNote = installed.skipped.length > 0 ? `\n\nSkipped (the repository already has them): ${installed.skipped.join(", ")}` : "";
  const ignoredBody = ignoredNote ? `\n\nNot committed — ${ignoredNote}` : "";
  const commit = await runGit(input.dir, ["commit", "-m", subject, "-m", `${body}${skippedNote}${ignoredBody}${trailer}`]);
  if (!commit.ok) return fail(`Could not commit the install: ${commit.stderr || commit.stdout}`);

  return {
    ok: true,
    written: toCommit,
    skipped: installed.skipped,
    ...ignoredField,
    committed: true,
    summary: `Installed ${toCommit.length} file(s)${installed.skipped.length > 0 ? `, skipped ${installed.skipped.length} the repo already had` : ""}${ignoredNote ? `; ${ignoredNote}` : ""}.`,
  };
}
