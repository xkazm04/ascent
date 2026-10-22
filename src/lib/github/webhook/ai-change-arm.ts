// MOONSHOT #1 - the live AI-change reducer for `pull_request_review` (approved) and
// `pull_request.closed` (merged), moved from src/app/api/app/webhook/route.ts
// (challenge-2026-10-22d github-app-0).
//
// AI involvement is decided by `readAiInvolvement`, IMPORTED from analyze/pulls.ts rather than
// re-implemented: the webhook-sourced rows and the scan-sourced rows have to be one population. The
// `trailer` channel needs commit messages the payload does not carry, so a trailer-only PR is picked
// up at the next scan - a bounded under-count, never an over-count.
//
// The bind: this arm used to write for whatever org the payload's owner login named. It now plans the
// row first (pure, no I/O), then binds on the STORED installation mapping only - no GitHub call, no
// token - and writes under the bound org. A refused bind releases the delivery and writes nothing.

import { readReviewApproval } from "@/lib/github/governance-events";
import { upsertLiveAiChange, type LiveAiChangeInput } from "@/lib/db/ai-changes";
import { readAiInvolvement } from "@/lib/analyze/pulls";
import type { PrNode } from "@/lib/github/graphql";
import { AI_TOOLS } from "@/lib/analyze/ai-tools";
import { bindDelivery } from "./owner-bind";
import type { WebhookPayload } from "./payload";

/** The AiChange row a delivery evidences, or null when it evidences none. Pure. */
export function planAiChange(event: string, payload: WebhookPayload, nowMs = Date.now()): LiveAiChangeInput | null {
  const fullName = payload.repository?.full_name;
  const pr = payload.pull_request;
  if (!fullName || !pr?.number || !pr.created_at) return null;

  const approval = event === "pull_request_review" ? readReviewApproval(payload) : null;
  const merged = event === "pull_request" && payload.action === "closed" && pr.merged === true;
  // A review that was not an approval, or a PR that closed without merging, is not evidence.
  if (!approval && !merged) return null;

  const node = {
    number: pr.number,
    title: pr.title ?? "",
    bodyText: pr.body ?? "",
    isDraft: pr.draft ?? false,
    state: merged ? "MERGED" : "OPEN",
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? null,
    closedAt: null,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    author: pr.user?.login ? { login: pr.user.login, __typename: pr.user.type === "Bot" ? "Bot" : "User" } : null,
    labels: { nodes: (pr.labels ?? []).map((l) => ({ name: l.name ?? "" })) },
    reviews: { totalCount: 0, nodes: [] },
    comments: { totalCount: 0 },
  } as PrNode;

  const ai = readAiInvolvement(node);
  // NOT AI-involved by the shared predicate means no row: a human PR would inflate the denominator.
  if (!ai.signal) return null;

  const tools = AI_TOOLS.filter((t) => new RegExp(t.token, "i").test(ai.toolText)).map((t) => t.name);
  return {
    repoFullName: fullName,
    prNumber: pr.number,
    title: pr.title ?? "",
    authorLogin: pr.user?.login ?? null,
    authorIsBot: pr.user?.type === "Bot",
    aiSignal: ai.signal,
    aiTools: tools.join(", "),
    state: merged ? "MERGED" : "OPEN",
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? null,
    mergeCommitSha: pr.merge_commit_sha ? pr.merge_commit_sha.toLowerCase() : null,
    approved: approval !== null,
    approverLogin: approval?.approverLogin ?? null,
    approvedAt: approval?.approvedAt ?? null,
    // The DELIVERY's arrival, not the review's submission time (see AiChange.approvalObservedAt).
    approvalObservedAt: approval ? new Date(nowMs).toISOString() : null,
  };
}

/** Plan, bind on the stored mapping, write. Failures are swallowed: a missed row is the next scan's. */
export async function runAiChangeArm(event: string, payload: WebhookPayload, deliveryId?: string): Promise<void> {
  const owner = payload.repository?.owner?.login;
  const row = owner ? planAiChange(event, payload) : null;
  if (!owner || !row) return;
  const bound = await bindDelivery(payload.installation?.id, owner.toLowerCase(), deliveryId, "stored-only");
  if (!bound) return;
  await upsertLiveAiChange(bound.orgSlug, row).catch(() => false);
}
