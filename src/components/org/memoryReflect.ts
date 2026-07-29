// The client contract for the Shared Org Memory reflection pass (/api/org/memory/reflect). Types only
// plus two fetch helpers, declared once and shared by MemoryReflectPanel and its proposal card — the
// same split memoryCheck.ts uses. No React, no server imports at runtime (`import type` is erased, so
// pulling MemoryRow from the db barrel never ships Prisma).

import type { MemoryRow } from "@/lib/db";
import type { ProviderName } from "@/lib/types";

/** One rollup the model proposed, joined to the rows it would supersede so the UI shows WHAT is at stake. */
export interface ReflectProposal {
  summaryContent: string;
  memberIds: string[];
  confidence: number;
  /** Mean pairwise similarity of the cluster this came from, 0..1 — how tight the family was. */
  cohesion: number;
  members: MemoryRow[];
}

export interface ReflectResponse {
  proposals: ReflectProposal[];
  /** Candidate families the DETERMINISTIC pass found. Compare against proposals.length: a gap means the
   *  model looked at a family and declined to roll it up, which is a real (and good) answer. */
  clusterCount: number;
  /** True when NO engine was reachable. Never conflate with `clusterCount === 0`, which means the pass
   *  ran and found nothing worth consolidating. */
  llmUnavailable: boolean;
  engine: ProviderName | "none";
  /** How many active memories the pass considered — so the UI never implies a whole-store scan. */
  consideredCount: number;
}

export interface ApplyResult {
  id: string;
  superseded: number;
}

async function post<T>(body: unknown, fallback: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api/org/memory/reflect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? fallback);
  }
  return (await res.json()) as T;
}

/**
 * Propose rollups. A pure read plus ONE model pass over at most 4 clusters — zero writes, which is why
 * it is safe to put behind a button. The caller owns an AbortController so navigating away cancels the
 * in-flight model call rather than leaving it running.
 */
export function runReflectPropose(
  input: { org: string; namespace?: string },
  signal?: AbortSignal,
): Promise<ReflectResponse> {
  return post<ReflectResponse>(input, "The reflection pass failed.", signal);
}

/**
 * Apply one proposal — the SECOND, explicit call, and the only one that writes. It creates the
 * `summary` memory and stamps every member `supersededBy` in one transaction. Nothing is deleted.
 */
export function runReflectApply(
  input: { org: string; proposal: ReflectProposal; namespace?: string },
): Promise<ApplyResult> {
  return post<ApplyResult>(
    {
      org: input.org,
      apply: {
        summaryContent: input.proposal.summaryContent,
        memberIds: input.proposal.memberIds,
        confidence: input.proposal.confidence,
        namespace: input.namespace || undefined,
      },
    },
    "Failed to write the summary.",
  );
}

/**
 * The honest empty state. Three outcomes look identical if you only count proposals, and they call for
 * three different actions from the reader — so they get three different sentences.
 */
export function reflectOutcomeCopy(r: ReflectResponse): { headline: string; detail: string } | null {
  if (r.proposals.length > 0) return null;
  if (r.llmUnavailable) {
    return {
      headline: "No model engine is available, so nothing was proposed.",
      detail:
        "Reflection needs a model: a rollup is prose, and a deterministic one would be a concatenation " +
        "masquerading as a synthesis — which would then supersede its sources. Configure LLM_PROVIDER " +
        "(and its key) to enable it. Nothing was changed.",
    };
  }
  if (r.clusterCount === 0) {
    return {
      headline: "Nothing to consolidate.",
      detail: `${r.consideredCount} active memor${r.consideredCount === 1 ? "y" : "ies"} were compared and no family of three or more restated the same subject.`,
    };
  }
  return {
    headline: `${r.clusterCount} similar famil${r.clusterCount === 1 ? "y" : "ies"} found, none worth rolling up.`,
    detail:
      "The model read each family and judged that they do not restate one subject — an unnecessary " +
      "rollup destroys detail, so it proposed none. Nothing was changed.",
  };
}
