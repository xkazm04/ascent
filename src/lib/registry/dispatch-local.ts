// A LOCAL registry dispatch: the brief is run by the local plane's agent inside an isolated worktree
// of the paired checkout, the residue is committed, the branch is pushed and a draft PR opened — and
// then the dispatch row says `proposed`, never `done`. Done is the sweep's verdict alone (it must
// SEE the map move on the default branch), which is why the last step here is a one-repo sweep and
// not a status flip. Spark knowledge-base-rebuild, WP2.
//
// Every side effect arrives through `deps` so the flow is testable with fakes; the defaults are the
// same helpers the loop's lanes use (worktree, agent, git, PR), which is where the guardrails live:
// the agent never touches the operator's working copy, is never given a shell, and never pushes —
// the runner pushes ONE branch, once, after the session.

import { runClaudeAgent, type AgentRunResult } from "@/lib/local/agent";
import { runGit } from "@/lib/local/git";
import { branchNameFor, createLoopWorktree, removeLoopWorktree, runStamp, type LoopWorktree } from "@/lib/local/loop-worktree";
import { markDispatch } from "@/lib/db/org-registry-dispatch";
import { sweepConformance } from "./conformance-sweep";
import { DISPATCH_TRAILER_KEY } from "./dispatch-brief";
import { openDispatchPr, type DispatchPrInput, type DispatchPrResult } from "./dispatch-pr";

/** Dispatch branches read as their own set beside the loop's `ascent/loop-…`. */
export const DISPATCH_BRANCH_PREFIX = "ascent/registry-";

export interface DispatchLocalDeps {
  createWorktree: (pairedPath: string, repo: string, stamp: string) => Promise<LoopWorktree>;
  removeWorktree: (wt: LoopWorktree) => Promise<void>;
  runAgent: (opts: { cwd: string; prompt: string }) => Promise<AgentRunResult>;
  git: typeof runGit;
  mark: typeof markDispatch;
  openPr: (input: DispatchPrInput) => Promise<DispatchPrResult>;
  sweep: typeof sweepConformance;
  now: () => Date;
}

export function defaultDispatchDeps(): DispatchLocalDeps {
  return {
    createWorktree: (pairedPath, repo, stamp) =>
      createLoopWorktree(pairedPath, repo, stamp, (r, s) => branchNameFor(r, s, DISPATCH_BRANCH_PREFIX)),
    removeWorktree: removeLoopWorktree,
    runAgent: runClaudeAgent,
    git: runGit,
    mark: markDispatch,
    openPr: openDispatchPr,
    sweep: sweepConformance,
    now: () => new Date(),
  };
}

export interface LocalDispatchInput {
  orgId: string;
  dispatchId: string;
  stage: string;
  repo: { repositoryId: string; fullName: string; defaultBranch: string; localPath: string };
  brief: string;
  /** Installation token — for the PR and the closing sweep. */
  token: string;
}

/** What the brief's "commit" steps mean under the local plane: the session has no shell, so the
 *  runner commits for it. Appended at run time; the brief itself stays the pure, digested text. */
export function localPostscript(branch: string): string {
  return (
    `\n\nLOCAL RUN CONTEXT:\n- You are in an isolated worktree on branch \`${branch}\`. DO NOT run git — this session has no shell permission and every git command will be refused. Leave your changes in the working tree; Ascent commits them for you the moment you exit, with the \`${DISPATCH_TRAILER_KEY}\` trailer, pushes the branch and opens the pull request.\n- NEVER push, never switch branches, never touch remotes.\n`
  );
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The default branch as the paired checkout's `origin/HEAD` names it; "main" when it does not say. */
export async function detectDefaultBranch(localPath: string | null, git: typeof runGit = runGit): Promise<string> {
  if (!localPath) return "main";
  const r = await git(localPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => null);
  const name = r?.ok ? r.stdout.trim().replace(/^origin\//, "") : "";
  return name || "main";
}

/** Commit whatever the session left dirty. Returns how many commits the branch carries past `base`. */
async function commitResidue(deps: DispatchLocalDeps, wt: LoopWorktree, base: string, input: LocalDispatchInput): Promise<number> {
  const status = await deps.git(wt.dir, ["status", "--porcelain"]);
  if (status.ok && status.stdout.trim().length > 0) {
    await deps.git(wt.dir, ["add", "-A"]);
    const subject = `registry: ${input.stage} for ${input.repo.fullName}`;
    const body = `Committed by an Ascent local registry dispatch.\n\n${DISPATCH_TRAILER_KEY}: ${input.dispatchId}`;
    const committed = await deps.git(wt.dir, ["commit", "-m", subject, "-m", body]);
    if (!committed.ok) throw new Error(`Could not commit the session's work: ${(committed.stderr || committed.stdout).slice(0, 400)}`);
  }
  const count = await deps.git(wt.dir, ["rev-list", "--count", `${base}..HEAD`]);
  return count.ok ? Number.parseInt(count.stdout.trim(), 10) || 0 : 0;
}

/**
 * Run one dispatch to a `proposed` PR (or `failed`), then sweep the repo once. Never throws: every
 * outcome is written on the row, and the worktree is removed whatever happened.
 */
export async function runLocalDispatch(deps: DispatchLocalDeps, input: LocalDispatchInput): Promise<void> {
  const { orgId, dispatchId, repo } = input;
  let wt: LoopWorktree | null = null;
  try {
    wt = await deps.createWorktree(repo.localPath, repo.fullName, runStamp(deps.now()));
    const head = await deps.git(wt.dir, ["rev-parse", "HEAD"]);
    if (!head.ok) throw new Error(`Could not read the worktree's HEAD: ${head.stderr || head.stdout}`);
    const base = head.stdout.trim();

    const result = await deps.runAgent({ cwd: wt.dir, prompt: input.brief + localPostscript(wt.branch) });
    await deps.mark(orgId, dispatchId, {
      status: "running",
      branch: wt.branch,
      model: result.model ?? null,
      costMicros: result.costMicros ?? null,
      turns: result.turns ?? null,
      agentDurationMs: result.durationMs ?? null,
      summary: result.summary,
    });
    if (!result.ok) throw new Error(result.summary);

    const commits = await commitResidue(deps, wt, base, input);
    if (commits === 0) throw new Error("the agent produced no commits");

    const [owner, name] = repo.fullName.split("/");
    if (!owner || !name) throw new Error(`${repo.fullName} is not an owner/name pair.`);
    const pr = await deps.openPr({
      token: input.token,
      owner,
      repo: name,
      pairedPath: repo.localPath,
      head: wt.branch,
      base: repo.defaultBranch,
      title: `Registry ${input.stage}: ${name}`,
      body: `Opened from an Ascent local registry dispatch (${input.stage}).\n\n- Branch: \`${wt.branch}\`\n- Commits: ${commits}\n\nAscent closes the dispatch when its sweep sees \`.ai/registry-map.json\` move on \`${repo.defaultBranch}\` — merge, then sweep.\n\n${DISPATCH_TRAILER_KEY}: ${dispatchId}`,
    });
    await deps.mark(orgId, dispatchId, { status: "proposed", branch: wt.branch, prUrl: pr.prUrl, endedAt: deps.now() });
  } catch (err) {
    await deps
      .mark(orgId, dispatchId, { status: "failed", branch: wt?.branch ?? null, error: errText(err), endedAt: deps.now() })
      .catch(() => null);
  } finally {
    if (wt) await deps.removeWorktree(wt).catch(() => null);
  }
  // Best-effort: the sweep degrades per repo on its own, and a failure here is not the dispatch's.
  await deps.sweep({ orgId }, input.token, { repositoryId: repo.repositoryId }).catch(() => null);
}
