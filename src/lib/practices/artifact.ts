// GENERATION for one practice, factored out of the PR plumbing so every door produces byte-identical
// content.
//
// Until the loop grew a practice lane there was exactly one caller (`applyPracticeToRepo`), and the
// house-pattern lookup that decides WHICH body gets generated lived privately inside it. A second
// door that re-resolved the pattern "equivalently" would eventually emit a different file than the
// PR the operator reviewed — the same failure mode the propose route's header warns about for
// `openBatch`. So the generation step is this module, and both the cloud PR path and the local
// worktree lane call it; only DELIVERY (a draft PR vs a write to disk) differs.

import { buildArtifact, type ArtifactSpec, type RepoContext } from "@/lib/practice-artifact";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";
import { minePracticeShapes, minedStarter } from "@/lib/org/practice-mining";

/** What the builder needs about the target repo. The house pattern is resolved here, not passed in. */
export type PracticeRepoContext = Omit<RepoContext, "house">;

export type HousePattern = { lines: string[]; exemplars: string[] };

export interface PracticeArtifactResult {
  /** Null for an unrecognized practice id — the caller's `unknown-practice` outcome. */
  artifact: ArtifactSpec | null;
  /** The org's own mined shape, when it had one. Callers record which shape shipped. */
  house: HousePattern | null;
}

/**
 * The org's mined pattern for one practice, or null when it has none.
 *
 * Null is the ordinary case for a young org and is NOT a failure: `buildArtifact` then emits the
 * generic starter and the PR body says so explicitly. A read failure also degrades to null — a
 * generic starter that says it is generic is always safe, whereas failing the apply would block a
 * write over a decoration.
 */
export async function resolveHousePattern(orgSlug: string, practiceId: string): Promise<HousePattern | null> {
  try {
    const shapes = await getOrgPracticeShapes(orgSlug);
    if (!shapes || shapes.length === 0) return null;
    const mined = minePracticeShapes(shapes).find((m) => m.practiceId === practiceId);
    if (!mined) return null;
    const lines = minedStarter(mined);
    return lines ? { lines, exemplars: mined.exemplars } : null;
  } catch {
    return null;
  }
}

/**
 * Build the artifact for `practiceId` against `ctx`, resolving the org's house pattern first when an
 * org slug is known. This IS the generation step — every door must go through it.
 */
export async function buildPracticeArtifact(
  practiceId: string,
  ctx: PracticeRepoContext,
  opts: { orgSlug?: string } = {},
): Promise<PracticeArtifactResult> {
  const house = opts.orgSlug ? await resolveHousePattern(opts.orgSlug, practiceId) : null;
  return { artifact: buildArtifact(practiceId, { ...ctx, house }), house };
}
