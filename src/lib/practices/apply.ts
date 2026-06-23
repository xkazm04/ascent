// The shared "open a starter PR for one practice into one repo" write pipeline, used by both
// /api/practices/apply (single) and /api/practices/apply-batch (fleet fan-out). Both routes ran the
// IDENTICAL sequence — fetchRepoContext → buildArtifact → null-guard → openDraftPr → recordAudit —
// with the audit payload differing only by a `batch: true` flag. Centralizing it here keeps the
// customer-repo WRITE path in lockstep: a change to artifact mapping, openDraftPr options, or the
// audit shape lands once. Each route keeps its OWN auth/tenant gating and HTTP error mapping (which
// legitimately differ); only this inner write sequence is shared. Errors propagate to the caller.

import { fetchRepoContext, type ParsedRepo, type RepoContextMeta } from "@/lib/github/source";
import { buildArtifact, type ArtifactSpec } from "@/lib/practice-artifact";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { recordAudit } from "@/lib/db";

export type ApplyPracticeResult =
  | { kind: "ok"; pr: OpenPrResult; ctx: RepoContextMeta; artifact: ArtifactSpec }
  | { kind: "unknown-practice"; ctx: RepoContextMeta };

/**
 * Open a draft PR seeding `practiceId`'s starter into `ref`, then audit-log it. Returns the PR +
 * resolved repo context + artifact on success, or a typed `unknown-practice` result (no PR opened)
 * when the practice id isn't recognized. Throws on GitHub/write failures so the caller can map them
 * to the right HTTP status. The `batch` flag is threaded straight into the audit payload.
 */
export async function applyPracticeToRepo(
  token: string,
  ref: ParsedRepo,
  practiceId: string,
  base: string | undefined,
  audit: { orgId?: string; actorId?: string; batch?: boolean },
): Promise<ApplyPracticeResult> {
  const ctx = await fetchRepoContext(ref, token);
  const artifact = buildArtifact(practiceId, ctx);
  if (!artifact) return { kind: "unknown-practice", ctx };

  const pr = await openDraftPr({
    token,
    owner: ref.owner,
    repo: ref.repo,
    branch: artifact.branch,
    base,
    path: artifact.path,
    content: artifact.body,
    commitMessage: artifact.commitMessage,
    prTitle: artifact.prTitle,
    prBody: artifact.prBody,
  });

  await recordAudit(
    "practice.pr_opened",
    {
      repo: ctx.fullName,
      practiceId,
      path: artifact.path,
      pr: pr.number,
      reused: pr.reused,
      ...(audit.batch ? { batch: true } : {}),
    },
    { orgId: audit.orgId, actorId: audit.actorId },
  );

  return { kind: "ok", pr, ctx, artifact };
}
