// AGENT ADMISSION (moonshot #8) — the customer-repo WRITE surface, and the sibling of
// `github/write.ts` rather than an edit to it.
//
// WHY A SIBLING. `openDraftPr` REFUSES to write a path that already exists on the base branch, by
// design: it seeds STARTER artifacts, and a PR that replaced a real CODEOWNERS with a scaffold would
// delete the customer's content — fanned across a whole fleet from one click. That refusal is
// load-bearing and is NOT relaxed here. A managed block is a different shape: it MERGES into the
// existing file and touches nothing outside its own markers. So it gets its own writer, built on the
// pure splice in `org/admission-artifacts.ts`, and `write.ts` keeps its rule intact.
//
// EVERY WRITE IS A PROPOSAL. Nothing in this module mutates a customer's repository without a
// preceding dry run: `proposeCodeownersBlock` with `confirm: false` reads the base file, renders the
// unified diff, and returns WITHOUT sending anything. The one true mutation — creating a branch
// ruleset — is a separate owner-only action with its own typed confirm, and it stores the created id
// so the same surface can reverse it.

import { AppApiError, githubAppFetch } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";
import { spliceManagedBlock, unifiedDiff } from "@/lib/org/admission-artifacts";
import type { RulesetProposal } from "@/lib/org/admission";

/** What a dry run tells the reviewer, and what a confirmed run then did. */
export interface ProposalResult {
  /** The unified diff of the managed-block splice. "" means nothing would change. */
  diff: string;
  willCreate: boolean;
  willModify: boolean;
  /** Present only on a CONFIRMED run that actually opened (or reused) a PR. */
  pr?: { url: string; number: number; branch: string; reused: boolean };
}

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** File content on a ref, or null when the path does not exist there. */
async function readFile(token: string, owner: string, repo: string, path: string, ref: string): Promise<{ content: string; sha: string } | null> {
  try {
    const file = await githubAppFetch<{ content?: string; encoding?: string; sha: string }>(
      `/repos/${owner}/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    if (!file.content) return null;
    return { content: Buffer.from(file.content, "base64").toString("utf8"), sha: file.sha };
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null;
    throw err;
  }
}

async function defaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const meta = await githubAppFetch<{ default_branch: string }>(`/repos/${owner}/${repo}`, token);
  return meta.default_branch;
}

export interface MergeProposalInput {
  token: string;
  owner: string;
  repo: string;
  path: string;
  /** The managed block, and the markers that delimit the ONLY region this writer may touch. */
  block: string;
  begin: string;
  end: string;
  branch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  /** FALSE (the default) means dry run: read, diff, and send NOTHING. */
  confirm?: boolean;
  base?: string;
}

/**
 * Splice a managed block into an existing file on a generated branch and open a draft PR — or, on a
 * dry run, return only the diff.
 *
 * The base file is read from the BASE branch, never from the generated branch: the diff a reviewer
 * approves must be the diff against what is actually shipping, and reading our own branch would show
 * a no-op after the first run.
 *
 * An EMPTY DIFF short-circuits before any write, on a confirmed run too. That is what makes the whole
 * flow idempotent: a recompile that changes nothing opens no PR, so the product does not train a team
 * to ignore its pull requests.
 */
export async function proposeManagedBlock(input: MergeProposalInput): Promise<ProposalResult> {
  const { token, owner, repo, path, block, begin, end } = input;
  const base = input.base ?? (await defaultBranch(token, owner, repo));
  const existing = await readFile(token, owner, repo, path, base);
  const before = existing?.content ?? "";
  const spliced = spliceManagedBlock(before, block, begin, end);
  const diff = unifiedDiff(path, before, spliced.content);
  const result: ProposalResult = { diff, willCreate: existing === null, willModify: existing !== null && spliced.changed };

  if (!input.confirm || !spliced.changed) return result;

  // Create the branch off base; tolerate "already exists" so a retry reuses it.
  const baseRef = await githubAppFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
    token,
  );
  try {
    await githubAppFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseRef.object.sha }),
    });
  } catch (err) {
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
  }
  // The blob sha must be the one on OUR branch (a re-run updates the file we wrote last time), while
  // the CONTENT is spliced from base — so a re-proposal after the customer edited their own file
  // outside the markers carries their edit forward instead of reverting it.
  const onBranch = await readFile(token, owner, repo, path, input.branch);
  await githubAppFetch(`/repos/${owner}/${repo}/contents/${encodePathSegments(path)}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message: input.commitMessage,
      content: enc(spliced.content),
      branch: input.branch,
      ...(onBranch ? { sha: onBranch.sha } : {}),
    }),
  });

  try {
    const pr = await githubAppFetch<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({ title: input.prTitle, head: input.branch, base, body: input.prBody, draft: true }),
    });
    result.pr = { url: pr.html_url, number: pr.number, branch: input.branch, reused: false };
  } catch (err) {
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
    const open = await githubAppFetch<{ html_url: string; number: number }[]>(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${input.branch}`)}&state=open`,
      token,
    );
    if (open[0]) result.pr = { url: open[0].html_url, number: open[0].number, branch: input.branch, reused: true };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Branch rulesets — the ONE real mutation, and its reversal
// ---------------------------------------------------------------------------

/** One rule as GitHub reports it back, reduced to what a dry run needs to compare. */
export interface ObservedRuleset {
  id: number;
  name: string;
  enforcement: string;
}

/** Rulesets currently on the repo. Read-only; used to show observed-vs-proposed before an apply. */
export async function listRulesets(token: string, owner: string, repo: string): Promise<ObservedRuleset[]> {
  const rows = await githubAppFetch<ObservedRuleset[]>(`/repos/${owner}/${repo}/rulesets`, token);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Create the proposed ruleset. THE ONE CALL IN THIS LANE THAT MUTATES A CUSTOMER'S REPOSITORY
 * CONFIGURATION rather than opening a reviewable PR, which is why its route requires an owner, a
 * same-origin request and a typed `confirm === "owner/repo"`, and why the id it returns is persisted:
 * a control the customer cannot undo from the surface that created it is a control they will disable
 * outside the product instead.
 */
export async function applyRuleset(token: string, owner: string, repo: string, proposal: RulesetProposal): Promise<string> {
  const created = await githubAppFetch<{ id: number }>(`/repos/${owner}/${repo}/rulesets`, token, {
    method: "POST",
    body: JSON.stringify(proposal),
  });
  return String(created.id);
}

/**
 * Remove a previously applied ruleset. A 404 is treated as SUCCESS: someone deleting it on GitHub
 * directly is the same end state the caller asked for, and failing here would strand the stored id
 * forever — leaving a reversal button that can never succeed.
 */
export async function revertRuleset(token: string, owner: string, repo: string, rulesetId: string): Promise<void> {
  try {
    await githubAppFetch(`/repos/${owner}/${repo}/rulesets/${encodeURIComponent(rulesetId)}`, token, { method: "DELETE" });
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return;
    throw err;
  }
}
