// The shared "open a starter PR for one practice into one repo" write pipeline, used by both
// /api/practices/apply (single) and /api/practices/apply-batch (fleet fan-out). Both routes ran the
// IDENTICAL sequence — fetchRepoContext → buildArtifact → null-guard → openDraftPr → recordAudit —
// with the audit payload differing only by a `batch: true` flag. Centralizing it here keeps the
// customer-repo WRITE path in lockstep: a change to artifact mapping, openDraftPr options, or the
// audit shape lands once. Each route keeps its OWN auth/tenant gating and HTTP error mapping (which
// legitimately differ); only this inner write sequence is shared. Errors propagate to the caller.

import { fetchRepoContext, type ParsedRepo, type RepoContextMeta } from "@/lib/github/source";
import { type ArtifactSpec } from "@/lib/practice-artifact";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { recordAudit, recordPracticePr } from "@/lib/db";
import { artifactFingerprint } from "@/lib/practices/fingerprint";
import { buildPracticeArtifact } from "@/lib/practices/artifact";
import { buildRegistryArtifact, registrySlugOf } from "@/lib/practices/registry-artifact";
import { getRegistryPracticeSource } from "@/lib/db/org-practice-shapes";
import { getLatestHousePattern } from "@/lib/db/house-pattern-versions";
import { recordProposedAdoption, type AdoptionSource } from "@/lib/db/practice-adoption";
import { contentDigest } from "@/lib/registry/parse";

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
  opts?: { expectedFingerprint?: string; orgSlug?: string },
): Promise<ApplyPracticeResult> {
  const ctx = await fetchRepoContext(ref, token);
  // MOONSHOT #33 — a `registry:<slug>` id is the org's OWN agreed practice, indexed out of its
  // registry repo, and it goes through THIS writer rather than a second one: same draft PR, same
  // audit row, same adoption row. Resolved before the catalog generator because the two id spaces are
  // disjoint and `buildArtifact` would only answer `unknown-practice` for it.
  const registrySlug = registrySlugOf(practiceId);
  if (registrySlug) {
    const source = audit.orgId ? await getRegistryPracticeSource(audit.orgId, registrySlug) : null;
    const spec = source ? buildRegistryArtifact(source) : null;
    // Unknown, archived or empty — all three are "nothing honest to commit", and the caller's
    // unknown-practice path already says so without opening a PR.
    if (!spec) return { kind: "unknown-practice", ctx };
    if (opts?.expectedFingerprint && artifactFingerprint(spec.body) !== opts.expectedFingerprint) {
      return { kind: "content-drift", ctx, artifact: spec };
    }
    const registryPr = await openArtifactDraftPr(token, ref, spec, base, {
      action: "practice.registry_applied",
      orgId: audit.orgId,
      actorId: audit.actorId,
      meta: {
        repo: ctx.fullName,
        practiceId,
        registryPath: source!.registryPath,
        ...(audit.batch ? { batch: true } : {}),
      },
    });
    // A registry starter is NOT version-tracked — `patternVersion: null` means "no house pattern
    // governs this", never "v0". It also has no ImprovementPr (that ledger is keyed to the nine
    // catalog practices' dimensions), so the census's own evidence promotes it after merge.
    if (audit.orgId) {
      await recordProposedAdoption({
        orgId: audit.orgId,
        repoFullName: ctx.fullName,
        practiceId,
        source: "registry",
        patternVersion: null,
        artifactPath: spec.path,
        proposedHash: contentDigest(spec.body),
        prNumber: registryPr.number,
      });
    }
    return { kind: "ok", pr: registryPr, ctx, artifact: spec };
  }

  // W6 — the org's OWN mined pattern for this practice, when it has one. Resolved inside
  // buildPracticeArtifact so BOTH the single apply, the batch fan-out and the LOCAL loop's practice
  // lane get it from one place, and so the preview (which calls the same generator through the same
  // context) sees the same body the PR will commit — otherwise the fingerprint drift-guard below
  // would reject every apply as content-drift.
  const { artifact, house } = await buildPracticeArtifact(practiceId, ctx, { orgSlug: opts?.orgSlug });
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
      // Which shape actually shipped. The audit trail is where "is the mining paying off?" gets
      // answered, and it cannot be reconstructed from the PR later.
      shape: house ? "house" : "generic",
      ...(house ? { houseExemplars: house.exemplars.length } : {}),
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

    // MOONSHOT #33 — the ADOPTION row, beside the PR row. `ImprovementPr` answers "did this PR land
    // and what did it buy"; this answers "is the artifact still there, and is it still the shape we
    // agreed on" — a question that outlives the PR by months. `patternVersion` is stamped only for a
    // house-shaped apply, so a generic starter reads as not-version-tracked rather than as v0/behind.
    const source: AdoptionSource = house ? "house" : "generic";
    const pattern = house ? await getLatestHousePattern(audit.orgId, practiceId).catch(() => null) : null;
    await recordProposedAdoption({
      orgId: audit.orgId,
      repoFullName: ctx.fullName,
      practiceId,
      source,
      patternVersion: pattern?.version ?? null,
      artifactPath: artifact.path,
      // The digest of what we COMMITTED. It is the proposal, not the baseline: reconciliation stamps
      // `adoptedHash` from what actually landed, because a reviewer editing the PR before merge is the
      // normal case and must not read as drift.
      proposedHash: contentDigest(artifact.body),
      prNumber: pr.number,
    });
  }

  return { kind: "ok", pr, ctx, artifact };
}
