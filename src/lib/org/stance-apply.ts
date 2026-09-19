// Shared "open AI_POLICY.md as a draft PR" write, used by /api/org/ai-stance/apply (single) and
// /api/org/ai-stance/apply-batch (fleet fan-out). Mirrors applyPracticeToRepo / applyPlaybookToRepo:
// each route keeps its own auth, tenant gate, and HTTP mapping; only this inner write is shared.

import { fetchRepoContext, type ParsedRepo } from "@/lib/github/source";
import { openArtifactDraftPr } from "@/lib/practices/apply";
import { buildStanceArtifact } from "@/lib/org/stance-artifact";
import type { OpenPrResult } from "@/lib/github/write";
import type { AiStance } from "@/lib/types";

export async function applyStanceToRepo(input: {
  token: string;
  ref: ParsedRepo;
  stance: AiStance;
  meta: { org: string; version: number; publishedAt?: string | null };
  base?: string;
  orgId?: string;
  actorId?: string;
  batch?: boolean;
}): Promise<{ pr: OpenPrResult; path: string; fullName: string }> {
  const repoCtx = await fetchRepoContext(input.ref, input.token);
  const artifact = buildStanceArtifact(input.stance, input.meta, repoCtx);
  const pr = await openArtifactDraftPr(input.token, input.ref, artifact, input.base, {
    action: "ai_stance.pr_opened",
    orgId: input.orgId,
    actorId: input.actorId,
    meta: {
      repo: repoCtx.fullName,
      stanceVersion: input.meta.version,
      ...(input.batch ? { batch: true } : {}),
    },
  });
  return { pr, path: artifact.path, fullName: repoCtx.fullName };
}
