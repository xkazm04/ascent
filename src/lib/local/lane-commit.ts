// THE LANE COMMITS THE AGENT'S WORK, BECAUSE THE AGENT CANNOT.
//
// L2-A-01 (uat/runs/2026-08-29-loop-l2): a real `claude -p` session edited files inside the lane's
// worktree for 5m46s and then could not run `git commit`. `--permission-mode acceptEdits`
// auto-accepts EDITS and not Bash, and headless `-p` has nobody to answer the permission prompt it
// raises instead — so the lane's own brief ("commit directly to it, one commit per resolved item")
// asked for the one action the flags make impossible. `removeLoopWorktree --force` then deleted the
// only copy: 0 commits, 5 dispatched items, the deliverable gone.
//
// THE DECISION, recorded because it is reversible and someone will want to revisit it. There were
// two fixes. (a) Widen `--allowedTools` so the agent may run `git add` / `git commit`. (b) Have the
// LANE commit after the agent exits. This is (b). Containment is the reason: `agent.ts`'s header
// chose `acceptEdits` over `--dangerously-skip-permissions` deliberately, calling worktree isolation
// "the real blast-radius bound" and the flag "the second belt", and an unattended agent that may
// execute git is a materially wider grant than one that may only write files. (b) also costs nothing
// the loop was relying on: `lane-install.ts` has always committed on the deterministic lanes' behalf,
// so this is the agent lane adopting the shape its two siblings already had.
//
// WHAT (b) HAD TO SOLVE, and the reason it was not free: the per-item `Ascent-Resolves:` trailers
// are what the adjudication reads (`parseResolvedIds` → `scans-persist`), and the agent is the only
// party that knows which items it actually resolved. So the brief now asks the session to END with
// `RESOLVED: <id>` / `SKIPPED: <id>` lines, and this module turns those into the trailer set. The
// trailer is a CLAIM, never a verdict, and a row still closes only when the next scan says its
// dimension moved.
//
// SILENCE CLAIMS NOTHING (UAT `PRIYA-L1-702`, 2026-08-31). This module used to trail EVERY armed id
// when the session named none, on the reading that "the batch was dispatched as a unit and the rescan
// is the thing that decides". Both halves turned out to be wrong. A live session was killed by the
// 20-minute timeout having written 0 item verdicts, and its lane log reads "5 Ascent-Resolves
// trailer(s) (the session named no ids, so the whole armed batch is claimed)" — a process that was
// stopped mid-thought had five rows stamped in its name. And the rescan was NOT deciding: the lane
// handed the raw trailer set straight to `recordLaneOutcomes`, so the claim WAS the verdict, and the
// cockpit printed it as "closed by the rescan". A silent session is the one case with no evidence of
// anything, so it now produces no trailer at all. Nothing is lost: a gap still closes on the
// rescan's own "no longer raised AND the dimension moved" rule, which needs no trailer.

import { runGit } from "@/lib/local/git";
import { FOLLOWUP_TRAILER } from "@/lib/org/followups";

/** Longest subject line the lane will write. Conventional git wisdom, and the history strip's width. */
const SUBJECT_MAX = 72;
/** How much of the agent's own text rides in the commit body. Generous: it is the only record of what
 *  the session thought it did, and the worktree it did it in is about to be deleted. */
const AGENT_BODY_MAX = 2_000;
/** `git add --` argv chunk. Windows' command line is finite and an agent can touch a lot of files. */
const ADD_CHUNK = 200;

export interface LaneCommitInput {
  /** The isolated worktree. Everything dirty in it is the agent's — nothing else runs there. */
  dir: string;
  branch: string;
  cycle: number;
  /** Every item this lane ARMED. `trailerIds` narrows these to the ones the session actually
   *  claimed — an armed id is not itself a claim. */
  batch: readonly { id: string }[];
  /** The agent session's own final text — the subject, the body, and the RESOLVED/SKIPPED claims. */
  summary: string;
  /**
   * DID THE SESSION END IN ERROR (timeout, crash, non-zero exit)?
   *
   * When it did, `summary` is not a description of the work — it is the runner's failure message,
   * and reading a subject line off it produces a commit whose title is the session's obituary. A
   * campaign lane landed 1605 insertions across 15 files under `fix: Agent session exceeded 20 min
   * and was stopped` (PRIYA-L2-C7): the one line every log, blame view and PR title shows named the
   * transport's problem instead of the change. The error still rides in the BODY, verbatim — it is
   * load-bearing evidence — but it never becomes the title.
   *
   * Optional, and `false` is what every caller before it meant.
   */
  sessionFailed?: boolean;
}

export interface LaneCommitResult {
  committed: boolean;
  /** Paths staged. 0 when the worktree was already clean. */
  files: number;
  /** The ids written as `Ascent-Resolves:` trailers. */
  resolved: string[];
  /** One line for the lane log — the reason, whichever way it went. */
  summary: string;
}

/**
 * The paths in a `git status --porcelain -z` reading, renames included.
 *
 * `-z` because a path with a space, a quote or a newline in it is a path git will quote in the
 * default format and this would then stage the wrong name. Untracked entries stay at git's NORMAL
 * granularity (a directory collapses to `dir/`), which is deliberate: `--untracked-files=all` on a
 * worktree where the agent ran an install enumerates thousands of paths, and `git add -- dir/`
 * already honours `.gitignore`.
 */
export function porcelainPaths(z: string): string[] {
  const fields = z.split("\0").filter((f) => f.length > 0);
  const out: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    out.push(field.slice(3));
    // A rename/copy entry is TWO NUL-terminated fields: the new path, then the original. Both are
    // staged — the delete half of a rename is as much of the change as the add half.
    if (xy.includes("R") || xy.includes("C")) {
      i += 1;
      const src = fields[i];
      if (src) out.push(src);
    }
  }
  return [...new Set(out)];
}

export interface AgentClaims {
  resolved: string[];
  skipped: string[];
}

/**
 * The `RESOLVED: <id>` / `SKIPPED: <id>` lines the brief asks the session to end with.
 *
 * An id the lane never ARMED is ignored rather than honoured. A session cannot enlarge its own batch
 * by naming rows it was not given — the claim would be unadjudicated by anything, since only armed
 * ids were moved to `in_progress`.
 */
export function parseAgentClaims(summary: string, armed: readonly string[]): AgentClaims {
  const armedSet = new Set(armed);
  const resolved = new Set<string>();
  const skipped = new Set<string>();
  for (const m of summary.matchAll(/^\s*[-*\s]*(RESOLVED|SKIPPED)\s*:\s*(\S+)/gim)) {
    const id = m[2]!.replace(/^[`'"([]+/, "").replace(/[`'")\],.;:]+$/, "");
    if (!armedSet.has(id)) continue;
    if (m[1]!.toUpperCase() === "RESOLVED") resolved.add(id);
    else skipped.add(id);
  }
  return { resolved: [...resolved], skipped: [...skipped] };
}

/**
 * Which armed ids get a trailer.
 *
 * Named RESOLVED ids win. When the session named only SKIPPED ones, the rest are trailed — "I did
 * not do these four" is a statement about the other one, and the session was alive and accounting
 * for its batch when it wrote it. When it named NOTHING, nothing is trailed: see the module header —
 * a session that said nothing (crashed, was killed by the timeout, ran out of turns) has made no
 * claim, and manufacturing five on its behalf is the one thing this function must not do.
 */
export function trailerIds(armed: readonly string[], claims: AgentClaims): string[] {
  if (claims.resolved.length > 0) return claims.resolved;
  if (claims.skipped.length > 0) return armed.filter((id) => !claims.skipped.includes(id));
  return [];
}

/** Anything shaped like a conventional-commit subject already. */
const CONVENTIONAL = /^[a-z]+(\([^)]*\))?!?:\s*\S/;

/**
 * The subject a lane writes when the session that produced the work ENDED IN ERROR.
 *
 * Neutral by construction: it describes what the commit IS — residue a lane rescued from a session
 * that did not finish — and claims nothing about what was fixed. The failure text is not lost; it is
 * the `Agent summary:` block in the body, where a reader looking for it will find it and a blame view
 * will not lead with it.
 */
export const INTERRUPTED_SUBJECT = "chore: partial work from an interrupted lane session";

/** The subject, from the agent's own first line — bounded, de-marked-down, never multi-line.
 *  `sessionFailed` short-circuits it: see `LaneCommitInput.sessionFailed`. */
export function laneCommitSubject(summary: string, items: number, sessionFailed = false): string {
  if (sessionFailed) return INTERRUPTED_SUBJECT;
  const raw = (summary.split("\n").find((l) => l.trim() && !/^\s*(RESOLVED|SKIPPED)\s*:/i.test(l)) ?? "")
    .replace(/^[#>\-*\s]+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "");
  const body = raw ? (CONVENTIONAL.test(raw) ? raw : `fix: ${raw}`) : `fix: resolve ${items} Ascent follow-up${items === 1 ? "" : "s"}`;
  if (body.length <= SUBJECT_MAX) return body;
  const cut = body.slice(0, SUBJECT_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).replace(/[,;:\-\s]+$/, "");
}

const WHY_THE_LANE_COMMITTED = [
  "Committed by the Ascent loop's lane, not by the agent that wrote it.",
  "",
  "A headless `claude -p` session runs under `--permission-mode acceptEdits`, which grants file edits",
  "and not Bash, so the session that made these changes could not run `git commit` itself. Widening",
  "its tool grant was the alternative and was declined: worktree isolation is the blast-radius bound",
  "and an unattended agent keeps the narrower permission. The lane stages what the session left in the",
  "worktree and commits it here (uat/runs/2026-08-29-loop-l2, finding L2-A-01).",
];

/** The full message. Split out so a test can pin the trailer format against the real parser. */
export function buildCommitMessage(input: LaneCommitInput, ids: readonly string[], claims: AgentClaims): { subject: string; body: string } {
  const subject = laneCommitSubject(input.summary, ids.length, input.sessionFailed === true);
  // The agent's own words, minus any trailer line it wrote: this message's trailers are the lane's
  // statement about the ids it armed, and a session must not be able to smuggle another row's id in
  // through prose the lane pastes verbatim.
  const agentText = input.summary
    .split("\n")
    .filter((l) => !new RegExp(`^\\s*${FOLLOWUP_TRAILER}\\s*:`, "i").test(l))
    .join("\n")
    .trim()
    .slice(0, AGENT_BODY_MAX);
  const lines = [...WHY_THE_LANE_COMMITTED, "", `Lane: cycle ${input.cycle} on ${input.branch}.`];
  if (input.sessionFailed) {
    lines.push(
      "",
      "THE SESSION ENDED IN ERROR (timeout, crash or a non-zero exit). What follows under 'Agent",
      "summary' is the runner's failure text, not an account of the work — the changes here are",
      "whatever the session had written into the worktree when it stopped, and they are unreviewed.",
    );
  }
  if (agentText) lines.push("", "Agent summary:", agentText);
  if (claims.skipped.length > 0) lines.push("", `The session reported these as skipped, so they carry no trailer: ${claims.skipped.join(", ")}.`);
  if (ids.length === 0 && input.batch.length > 0) {
    lines.push(
      "",
      `The session ended without naming any item as RESOLVED or SKIPPED, so this commit claims none of the ${input.batch.length} item(s) it was armed with.`,
      "The next scan of this branch judges the work on its own evidence.",
    );
  }
  if (ids.length > 0) lines.push("", ...ids.map((id) => `${FOLLOWUP_TRAILER}: ${id}`));
  return { subject, body: lines.join("\n") };
}

/**
 * Stage whatever the agent left in the worktree and commit it. Never throws: every outcome is lane
 * data, exactly like `installInWorktree`, so a repo that cannot be committed does not take its run's
 * siblings with it. A failure here falls back to the honest lost-work log the lane already writes.
 *
 * Staging is BY PATH, never `add -A` — the same rule `lane-install.ts` holds, for the same reason.
 * The worktree is an isolated scratch checkout nothing else writes to, so its whole diff IS the
 * agent's work; naming the paths keeps that an assertion rather than an assumption.
 */
export async function commitAgentWork(input: LaneCommitInput): Promise<LaneCommitResult> {
  const status = await runGit(input.dir, ["status", "--porcelain", "-z"]);
  if (!status.ok) {
    return { committed: false, files: 0, resolved: [], summary: `Could not read the worktree, so nothing was committed: ${status.stderr || status.stdout}` };
  }
  const paths = porcelainPaths(status.stdout);
  if (paths.length === 0) {
    return { committed: false, files: 0, resolved: [], summary: "Nothing left uncommitted in the worktree — the lane had nothing to commit." };
  }
  for (let i = 0; i < paths.length; i += ADD_CHUNK) {
    const added = await runGit(input.dir, ["add", "--", ...paths.slice(i, i + ADD_CHUNK)]);
    if (!added.ok) {
      return { committed: false, files: paths.length, resolved: [], summary: `Could not stage the agent's ${paths.length} change(s): ${added.stderr || added.stdout}` };
    }
  }
  const claims = parseAgentClaims(input.summary, input.batch.map((b) => b.id));
  const ids = trailerIds(
    input.batch.map((b) => b.id),
    claims,
  );
  const { subject, body } = buildCommitMessage(input, ids, claims);
  const commit = await runGit(input.dir, ["commit", "-m", subject, "-m", body]);
  if (!commit.ok) {
    return { committed: false, files: paths.length, resolved: [], summary: `Could not commit the agent's ${paths.length} change(s): ${commit.stderr || commit.stdout}` };
  }
  const named = claims.resolved.length > 0 || claims.skipped.length > 0;
  return {
    committed: true,
    files: paths.length,
    resolved: ids,
    summary:
      `The lane committed the agent's ${paths.length} change(s) on ${input.branch} — ` +
      `${ids.length} ${FOLLOWUP_TRAILER} trailer(s)${named ? " from the session's own RESOLVED/SKIPPED lines" : " (the session named no ids, so it claimed nothing — the rescan judges the batch on its own evidence)"}.`,
  };
}
