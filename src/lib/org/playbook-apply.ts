// The shared "open a draft PR seeding one playbook into one repo" write pipeline, used by both
// /api/org/playbooks/[id]/apply (single) and /api/org/playbooks/[id]/apply-batch (fleet fan-out).
// Mirrors src/lib/practices/apply.ts exactly in intent: the customer-repo WRITE sequence lives in one
// place so branch/path naming, the committed body, the adoption mark and the audit row can't drift
// between the two routes. Each route keeps its OWN auth/tenant gating and HTTP error mapping (which
// legitimately differ — a batch reports per-repo, a single call maps to one status). Errors propagate.

import { fetchRepoContext } from "@/lib/github/source";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { applyPlaybook, recordOrgAudit, type PlaybookRow } from "@/lib/db";
import { playbookMarkdown, playbookStarterFile } from "@/lib/org/playbook-brief";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { slugify } from "@/lib/slug";

// Branch-name-length cap (60), distinct from the file-path cap used elsewhere — kept as a parameter
// to `slugify`, not flattened, since the two feed different downstream limits.
const slug = (s: string) => slugify(s, 60, "playbook");

/**
 * Open the playbook's draft PR into `parsed`, then record the adoption mark + audit row.
 *
 * The bookkeeping after the PR is BEST-EFFORT and deliberately swallowed: by then the PR exists on
 * GitHub, so surfacing a bookkeeping failure as an error sends the caller to retry and open a
 * DUPLICATE. "PR opened but a follow-up step failed" must never look like "PR not opened".
 */
export async function applyPlaybookToRepo(input: {
  token: string;
  /** The playbook's owning org slug (already resolved + authorized by the caller). */
  org: string;
  playbook: PlaybookRow;
  parsed: { owner: string; repo: string };
  base?: string;
  actorLogin: string | null;
  /** Flags the audit row as part of a fleet rollout (mirrors the practices batch's `batch: true`). */
  batch?: boolean;
}): Promise<{ pr: OpenPrResult; fullName: string }> {
  const { token, org, playbook, parsed, base, actorLogin } = input;
  const id = playbook.id;
  const dimLabel = DIMENSION_SHORT[playbook.dimId as DimensionId] ?? playbook.dimId;
  const brief = playbookMarkdown(playbook, dimLabel);
  // Single-sourced with the PlaybookCard "Preview starter" so the preview matches what's committed.
  const fileBody = playbookStarterFile(playbook, dimLabel);

  const ctxRepo = await fetchRepoContext(parsed, token);
  const pr = await openDraftPr({
    token,
    owner: parsed.owner,
    repo: parsed.repo,
    // Namespace the branch + committed file by the playbook's DB id (its true identity), not only the
    // human title slug: two distinct playbooks whose titles slug identically (e.g. "Our CI standard" /
    // "Our CI Standard!") used to collide on the SAME branch/file, so applying B reused A's open PR and
    // overwrote it with B's content while adoption was recorded against B's id. (playbooks #2)
    branch: `ascent/playbook-${id}-${slug(playbook.title)}`,
    base,
    path: `docs/playbooks/${id}-${slug(playbook.title)}.md`,
    content: fileBody,
    commitMessage: `docs: adopt "${playbook.title}" playbook (via Ascent)`,
    prTitle: `Adopt playbook: ${playbook.title}`,
    prBody: brief,
  });

  try {
    await applyPlaybook(org, id, ctxRepo.fullName, actorLogin);
    await recordOrgAudit(
      "playbook.pr_opened",
      org,
      { repo: ctxRepo.fullName, playbookId: id, pr: pr.number, reused: pr.reused, ...(input.batch ? { batch: true } : {}) },
      actorLogin ?? undefined,
    );
  } catch (bookkeepErr) {
    console.error(
      "[playbooks/apply] PR opened but adoption/audit bookkeeping failed",
      bookkeepErr instanceof Error ? bookkeepErr.message : bookkeepErr,
    );
  }

  return { pr, fullName: ctxRepo.fullName };
}
