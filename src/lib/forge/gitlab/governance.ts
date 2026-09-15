// GitLab protected branches + push rules → the existing `Governance` shape.
//
// THE RULE THIS FILE OBEYS: a field GitLab genuinely does not have is `false`, and the capability
// table in `docs/features/github/forges.md` says WHICH ones those are. It is never `true` "because
// GitLab is probably fine", which would hand a GitLab repo governance credit it did not earn, and it
// is never a fabricated middle value. `readable` reports whether the protection API answered at all —
// a token without the scope reads as NOT READABLE, which is the honest null, not "unprotected".

import type { Governance } from "@/lib/types";
import { gitlabGetSoft, projectRef, type GitlabFetchOpts } from "@/lib/forge/gitlab/http";

/** The subset of `GET /projects/:id/protected_branches` this mapper reads. */
export interface GlProtectedBranch {
  name?: string;
  push_access_levels?: { access_level?: number }[];
  merge_access_levels?: { access_level?: number }[];
  code_owner_approval_required?: boolean;
  allow_force_push?: boolean;
}

/** The subset of `GET /projects/:id/approvals` (project-level MR approval settings). */
export interface GlApprovalSettings {
  approvals_before_merge?: number;
  merge_requests_author_approval?: boolean;
}

/** The subset of `GET /projects/:id/push_rule`. */
export interface GlPushRule {
  reject_unsigned_commits?: boolean;
}

/** The subset of `GET /projects/:id` this mapper reads for merge-method / pipeline gating. */
export interface GlProjectGovernance {
  default_branch?: string;
  merge_method?: string; // merge | rebase_merge | ff
  only_allow_merge_if_pipeline_succeeds?: boolean;
}

/** GitLab's "no one" push access level. A protected branch whose push level is 0 for every entry is
 *  the shape that actually forces changes through a merge request. */
const ACCESS_NO_ONE = 0;

/**
 * PURE mapper: the four GitLab reads → `Governance`. Every argument is nullable because every read is
 * soft (a token without a scope returns null), and the mapping of each null is stated per field.
 *
 * Field-by-field, and why:
 *  - `protected`               — a protected-branch entry exists for the default branch.
 *  - `requiresPullRequest`     — nobody may push directly (every push access level is "no one"), which
 *                                is GitLab's equivalent of GitHub's "require a pull request".
 *  - `requiredApprovals`       — the project's `approvals_before_merge`. 0 when the approvals API was
 *                                unreadable, matching GitHub's behaviour when no rule is returned.
 *  - `requiresCodeOwnerReview` — `code_owner_approval_required` on the protected branch.
 *  - `requiresStatusChecks`    — `only_allow_merge_if_pipeline_succeeds` on the project.
 *  - `requiresSignatures`      — the push rule `reject_unsigned_commits`.
 *  - `linearHistory`           — `merge_method` is `ff` (fast-forward only). `rebase_merge` still
 *                                permits merge commits from the UI, so it does NOT count.
 *  - `ruleCount`               — protected-branch entries. A count, not a score.
 */
export function mapGovernance(input: {
  defaultBranch: string;
  branches: GlProtectedBranch[] | null;
  approvals: GlApprovalSettings | null;
  pushRule: GlPushRule | null;
  project: GlProjectGovernance | null;
}): Governance | null {
  const { defaultBranch, branches, approvals, pushRule, project } = input;
  // The protected-branch list is the ONE read this shape cannot be built without. Null means the API
  // did not answer, which is "not observable" — and `readable: false` is exactly how the GitHub path
  // already reports that, so every downstream consumer already handles it.
  if (!branches) return null;

  const entry =
    branches.find((b) => b.name === defaultBranch) ??
    // GitLab protected-branch names may be wildcards (`main*`, `release/*`). One level of glob is
    // enough to catch the common `*` / `main*` cases without pulling in a matcher library.
    branches.find((b) => typeof b.name === "string" && globMatches(b.name, defaultBranch)) ??
    null;

  const pushLevels = entry?.push_access_levels ?? [];
  const noDirectPush = pushLevels.length > 0 && pushLevels.every((l) => l.access_level === ACCESS_NO_ONE);

  return {
    defaultBranch,
    protected: Boolean(entry),
    requiresPullRequest: noDirectPush,
    requiredApprovals: Math.max(0, Math.trunc(approvals?.approvals_before_merge ?? 0)),
    requiresCodeOwnerReview: entry?.code_owner_approval_required === true,
    requiresStatusChecks: project?.only_allow_merge_if_pipeline_succeeds === true,
    requiresSignatures: pushRule?.reject_unsigned_commits === true,
    linearHistory: project?.merge_method === "ff",
    ruleCount: branches.length,
    readable: true,
  };
}

/** One-level glob for a protected-branch pattern (`*` matches any run of characters). */
export function globMatches(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name;
  const rx = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
  return rx.test(name);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fetch the four reads and map them. Soft everywhere: any unreadable part degrades a FIELD, and only
 *  an unreadable protected-branch list degrades the whole record to null. */
export async function fetchGitlabGovernance(
  fullPath: string,
  defaultBranch: string,
  opts: GitlabFetchOpts & { externalId?: string } = {},
): Promise<Governance | null> {
  const ref = projectRef(fullPath, opts.externalId);
  const [branches, approvals, pushRule, project] = await Promise.all([
    gitlabGetSoft<GlProtectedBranch[]>(`/projects/${ref}/protected_branches?per_page=100`, opts),
    gitlabGetSoft<GlApprovalSettings>(`/projects/${ref}/approvals`, opts),
    gitlabGetSoft<GlPushRule>(`/projects/${ref}/push_rule`, opts),
    gitlabGetSoft<GlProjectGovernance>(`/projects/${ref}`, opts),
  ]);
  return mapGovernance({ defaultBranch, branches, approvals, pushRule, project });
}
