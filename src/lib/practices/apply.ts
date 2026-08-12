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
import { recordAudit, recordPracticePr } from "@/lib/db";
import { artifactFingerprint } from "@/lib/practices/fingerprint";

/**
 * The shared "open a draft PR seeding one generated artifact, then audit-log it" step — the inner
 * write both the practice apply AND the AI-stance AI_POLICY.md apply run through, so a change to
 * openDraftPr options or the audit envelope lands once instead of forking the customer-repo write
 * path. `audit.meta` carries the caller's payload; `path`/`pr`/`reused` are appended uniformly.
 */
export async function openArtifactDraftPr(
  token: string,
  ref: ParsedRepo,
  artifact: ArtifactSpec,
  base: string | undefined,
  audit: { action: string; orgId?: string; actorId?: string; meta?: Record<string, unknown> },
): Promise<OpenPrResult> {
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
    audit.action,
    { ...(audit.meta ?? {}), path: artifact.path, pr: pr.number, reused: pr.reused },
    { orgId: audit.orgId, actorId: audit.actorId },
  );

  return pr;
}

export type ApplyPracticeResult =
  | { kind: "ok"; pr: OpenPrResult; ctx: RepoContextMeta; artifact: ArtifactSpec }
  | { kind: "unknown-practice"; ctx: RepoContextMeta }
  /** The regenerated artifact no longer matches what the caller previewed (repo context changed
   *  between preview and apply) — no PR opened; the caller should re-preview. */
  | { kind: "content-drift"; ctx: RepoContextMeta; artifact: ArtifactSpec };

/**
 * Open a draft PR seeding `practiceId`'s starter into `ref`, then audit-log it. Returns the PR +
 * resolved repo context + artifact on success, or a typed `unknown-practice` result (no PR opened)
 * when the practice id isn't recognized. Throws on GitHub/write failures so the caller can map them
 * to the right HTTP status. The `batch` flag is threaded straight into the audit payload.
 *
 * `expectedFingerprint` (when given) is the fingerprint of the body the caller PREVIEWED: apply
 * regenerates from live repo context, so this is the only thing tying the committed content to the
 * reviewed content. A mismatch returns `content-drift` (no PR opened) instead of silently landing
 * content the user never saw.
 */
export async function applyPracticeToRepo(
  token: string,
  ref: ParsedRepo,
  practiceId: string,
  base: string | undefined,
  audit: { orgId?: string; actorId?: string; batch?: boolean },
  opts?: { expectedFingerprint?: string },
): Promise<ApplyPracticeResult> {
  const ctx = await fetchRepoContext(ref, token);
  const artifact = buildArtifact(practiceId, ctx);
  if (!artifact) return { kind: "unknown-practice", ctx };
  if (opts?.expectedFingerprint && artifactFingerprint(artifact.body) !== opts.expectedFingerprint) {
    return { kind: "content-drift", ctx, artifact };
  }

  const pr = await openArtifactDraftPr(token, ref, artifact, base, {
    action: "practice.pr_opened",
    orgId: audit.orgId,
    actorId: audit.actorId,
    meta: {
      repo: ctx.fullName,
      practiceId,
      ...(audit.batch ? { batch: true } : {}),
    },
  });

  // Lifecycle: hand the PR to the SAME ImprovementPr machinery the war room polls (merge detection +
  // post-merge impact), so applying a practice no longer dead-ends at an audit row — the practices
  // page can show in-flight / landed / measured lift for what it opened. Org-scoped by nature: an
  // apply outside an org context (no orgId) has nowhere to hang the row. Never throws.
  if (audit.orgId) {
    await recordPracticePr({
      orgId: audit.orgId,
      repoFullName: ctx.fullName,
      practiceId,
      prNumber: pr.number,
      prUrl: pr.url,
      openedBy: audit.actorId ?? null,
    });
  }

  return { kind: "ok", pr, ctx, artifact };
}
