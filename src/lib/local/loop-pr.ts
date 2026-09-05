// THE ONE PLACE THE LOOP LEAVES THE MACHINE — push a lane's branch and open a reviewed PR.
//
// Everything else in local mode is deliberately push-free: a lane works in an isolated worktree, on
// its own branch, and the branch is the deliverable a human inspects. That was the whole safety
// story, and it is why the loop could be left running. It also meant agent-authored work never
// reached a reviewer, an `AiChange` row, or the conformance population — the evidence chain stopped
// at a branch on somebody's laptop.
//
// So the push exists, and it is ONE OWNER CLICK, never automatic. No scheduler calls this, the drive
// does not call it, and a lane never calls it for itself.
//
// WHY NOT `openDraftPr`. That helper (src/lib/github/write.ts) creates a branch off base and PUTs a
// single file through the Contents API — it is for a starter artifact Ascent authored, and it cannot
// open a PR for a branch that already carries local commits. This pushes the real branch with git and
// POSTs `/pulls` directly, reusing the same 422-means-one-is-already-open handling.
//
// NEVER `--force`. A rejected non-fast-forward surfaces as a refusal carrying git's own message: if
// the remote branch has moved, a human needs to look, and force-pushing over it from an unattended
// remediation surface is exactly the accident this whole design has been avoiding.

import { runGit } from "@/lib/local/git";
import { AppApiError, getInstallationToken, githubAppFetch } from "@/lib/github/app";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { recordLoopPr } from "@/lib/db/improvement-events";
import { updateLane } from "@/lib/db/loop-runs";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";

export interface OpenLanePrResult {
  prNumber: number;
  prUrl: string;
  /** True when an open PR for this head already existed and was returned instead of a new one. */
  reused: boolean;
}

/** Pushing takes longer than an API call and is the one step that touches the network from git. */
const PUSH_TIMEOUT_MS = 120_000;

/** The PR body: what the lane actually did, in the reviewer's own terms. */
function prBody(lane: LoopLaneRecord): string {
  const lines = [
    "Opened from an Ascent local remediation lane.",
    "",
    `- Branch: \`${lane.branch}\``,
    `- Commits: ${lane.commits}`,
    `- Follow-ups the rescan closed: ${lane.closedIds.length}`,
    lane.dimId ? `- Dominant dimension: ${lane.dimId}` : null,
    lane.model ? `- Agent: ${lane.model}` : null,
    "",
    "The lane's own rescan measured this work **on this branch**. It is not counted as bought until",
    "this PR merges and the next default-branch scan confirms it — that is the point of the review.",
    "",
    lane.closedIds.length > 0 ? `Closed follow-up ids: ${lane.closedIds.slice(0, 20).join(", ")}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/**
 * Push the lane's branch from the PAIRED clone (not the worktree — that is long gone by the time
 * anyone reviews a finished lane; the branch itself lives in the repository's own object store) and
 * open a draft PR for it.
 *
 * Never throws anything but `AppApiError`, so the route has exactly one shape to map.
 */
export async function openPrForLane(input: {
  orgSlug: string;
  orgId: string;
  lane: LoopLaneRecord;
  pairedPath: string;
  actor: string | null;
}): Promise<OpenLanePrResult> {
  const { lane, pairedPath } = input;
  const [owner, repo] = lane.repoFullName.split("/");
  if (!owner || !repo) throw new AppApiError(400, lane.repoFullName, "Lane repo is not an owner/name pair.");
  if (!lane.branch) throw new AppApiError(409, lane.repoFullName, "This lane has no branch to open a PR for.");
  // `ImprovementPr.dimId` is NOT nullable, and there is no honest value to invent: a lane whose batch
  // spanned no dimension cannot be filed in the improvement ledger under one. Refuse with the reason.
  if (!lane.dimId) {
    throw new AppApiError(
      409,
      lane.repoFullName,
      "This lane has no dominant dimension, so its work cannot be filed in the improvement ledger. Open the PR by hand from the branch.",
    );
  }

  const pushed = await runGit(pairedPath, ["push", "--set-upstream", "origin", lane.branch], { timeoutMs: PUSH_TIMEOUT_MS });
  if (!pushed.ok) {
    // git's own words, not a paraphrase: a non-fast-forward, a missing remote and a credential
    // failure need three different human responses and only git knows which one happened.
    throw new AppApiError(409, lane.repoFullName, `Could not push ${lane.branch}: ${(pushed.stderr || pushed.stdout).slice(0, 400)}`);
  }

  const installationId = await getInstallationIdForOwner(owner);
  if (!installationId) {
    throw new AppApiError(409, lane.repoFullName, `No GitHub App installation for ${owner}, so Ascent cannot open the PR. The branch is pushed — open it by hand.`);
  }
  const token = await getInstallationToken(installationId);

  let result: OpenLanePrResult;
  try {
    const pr = await githubAppFetch<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({
        title: `Ascent loop: ${lane.dimId} on ${repo} (cycle ${lane.cycle})`,
        head: lane.branch,
        base: undefined,
        body: prBody(lane),
        draft: true,
      }),
    });
    result = { prNumber: pr.number, prUrl: pr.html_url, reused: false };
  } catch (err) {
    // 422 is GitHub's "a PR for this head already exists" — the same reuse path `openDraftPr` takes,
    // so a second click is idempotent rather than an error.
    if (err instanceof AppApiError && err.status === 422) {
      const open = await githubAppFetch<{ html_url: string; number: number }[]>(
        `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${lane.branch}`)}&state=open`,
        token,
      );
      if (!open[0]) throw err;
      result = { prNumber: open[0].number, prUrl: open[0].html_url, reused: true };
    } else {
      throw err;
    }
  }

  // The ledger row and the denormalized lane columns. `beforeScanId` is the lane's own baseline, so
  // the post-merge verification compares against the very scan the branch measurement used — which is
  // what lets the points move from in-review to bought with no re-measurement.
  await recordLoopPr({
    orgId: input.orgId,
    laneId: lane.id,
    repoFullName: lane.repoFullName,
    dimId: lane.dimId,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    beforeScanId: lane.beforeScanId,
    openedBy: input.actor,
  }).catch(() => false);
  await updateLane(lane.id, { prNumber: result.prNumber, prUrl: result.prUrl }).catch(() => null);

  return result;
}
