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
  written: string[];
  skipped: string[];
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

  // Stage BY PATH, never `add -A`: a worktree can carry an agent's scratch from an earlier cycle, and
  // a deterministic install must commit exactly what it generated.
  const added = await runGit(input.dir, ["add", "--", ...installed.written]);
  if (!added.ok) return fail(`Could not stage the install: ${added.stderr || added.stdout}`);

  const trailer = input.resolvesId ? `\n\n${FOLLOWUP_TRAILER}: ${input.resolvesId}` : "";
  const skippedNote = installed.skipped.length > 0 ? `\n\nSkipped (the repository already has them): ${installed.skipped.join(", ")}` : "";
  const commit = await runGit(input.dir, ["commit", "-m", subject, "-m", `${body}${skippedNote}${trailer}`]);
  if (!commit.ok) return fail(`Could not commit the install: ${commit.stderr || commit.stdout}`);

  return {
    ok: true,
    written: installed.written,
    skipped: installed.skipped,
    committed: true,
    summary: `Installed ${installed.written.length} file(s)${installed.skipped.length > 0 ? `, skipped ${installed.skipped.length} the repo already had` : ""}.`,
  };
}
