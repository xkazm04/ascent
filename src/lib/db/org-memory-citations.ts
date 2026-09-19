// `OrgMemoryCitation` — the first evidence in this codebase that a delivered memory was actually USED.
//
// WHAT THIS CLOSES. `src/lib/memory/recall.ts` has always been explicit that `accessCount` counts
// DELIVERIES, not uses: "a memory injected into fifty prompts and ignored in all fifty scores exactly
// like one that answered the question fifty times". Its header named the two ways to close that gap
// and ruled one of them out (an LLM judging usefulness after the fact would be a fabricated signal
// dressed as a measurement). The other — "a distinct, evidence-bearing counter fed only by an act
// that PROVES use" — needed a column that module could not add. This is that store.
//
// WHAT IT IS STILL NOT. A citation is an agent's SELF-REPORT. It is stronger evidence than delivery
// (the agent had to take a second, deliberate action naming the memory) and weaker than proof (the
// agent could be wrong, or generous with itself). Every surface that reads these counts must keep
// saying which of the two it has. The counter is named `citedCount`, not `usefulCount`, for exactly
// that reason.
//
// TWO COUNTERS, NEVER NETTED. `citedCount` and `notUsefulCount` are separate columns and are never
// subtracted from one another: a memory nobody has cited and a memory five agents have explicitly
// rejected are different situations needing different actions (write one, retire the other), and a
// single net score erases the difference.
//
// IDEMPOTENT BY CONSTRAINT. `@@unique([memoryId, sessionId])` is the identity: one session gets one
// vote per memory. A retried tool call is an UPDATE of that vote, not a second one, so an agent that
// loops cannot manufacture evidence — and a genuine change of mind within a session (cited, then
// found it did not apply) moves the vote between the two counters rather than adding to both.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

/** One citation, client-facing. `createdAt` is an ISO string, per the wire-safe-dates rule. */
export interface MemoryCitationRow {
  id: string;
  memoryId: string;
  /** The caller's declared identity (agent name / token name). "" when it declared none. */
  actor: string;
  sessionId: string;
  used: boolean;
  /** The agent's one-line reason. Null when it gave none. ORG-AUTHORED TEXT — never re-serve raw. */
  note: string | null;
  /** Where the citation entered: `mcp` today. */
  source: string;
  createdAt: string;
}

/** Longest note kept. A citation is a reason, not a report; anything longer is the agent thinking
 *  out loud into a column that will be re-served to another model. */
export const CITATION_NOTE_MAX = 500;

export interface MemoryCitationInput {
  memoryId: string;
  sessionId: string;
  used: boolean;
  actor?: string | null;
  note?: string | null;
  tokenId?: string | null;
  source?: string;
}

/**
 * The outcome of one citation write.
 *
 * `unknown-memory` is deliberately NOT an error: the caller supplied a row id and this query is
 * constrained by the token's own org, so a foreign or invented id is simply not found (gate-then-
 * constrain, the rule `[id]` routes follow). Reporting it as "not in this organization" tells the
 * agent something true without confirming whether the id exists somewhere else.
 */
export type CitationOutcome = "created" | "updated" | "unchanged" | "unknown-memory" | "not-persisted";

export interface CitationResult {
  outcome: CitationOutcome;
  /** The memory's counts AFTER this write — null when nothing was written. */
  counts: { citedCount: number; notUsefulCount: number } | null;
}

const clip = (v: string | null | undefined, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Record (or revise) one session's vote on one memory, and keep the denormalized counters on
 * `OrgMemory` in step with it — in ONE transaction, because a counter that can drift from its own
 * evidence table is worse than no counter: it would rank memories on a number nothing can rebuild.
 */
export async function recordMemoryCitation(
  orgSlug: string,
  input: MemoryCitationInput,
): Promise<CitationResult> {
  if (!isDbConfigured()) return { outcome: "not-persisted", counts: null };
  const memoryId = clip(input.memoryId, 200);
  const sessionId = clip(input.sessionId, 200);
  if (!memoryId || !sessionId) return { outcome: "unknown-memory", counts: null };

  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { outcome: "unknown-memory", counts: null };

  // THE TENANT BOUNDARY. The memory must belong to the token's own org before anything is written.
  const memory = await prisma.orgMemory.findFirst({ where: { id: memoryId, orgId }, select: { id: true } });
  if (!memory) return { outcome: "unknown-memory", counts: null };

  const existing = await prisma.orgMemoryCitation.findUnique({
    where: { memoryId_sessionId: { memoryId, sessionId } },
    select: { id: true, used: true },
  });

  const data = {
    used: input.used,
    note: clip(input.note, CITATION_NOTE_MAX),
    actor: clip(input.actor, 200) ?? "",
    tokenId: clip(input.tokenId, 200),
    source: clip(input.source, 40) ?? "mcp",
  };

  // The counter delta, derived from the vote's TRANSITION rather than from its value: a first vote
  // adds one, a repeated identical vote adds nothing, and a flipped vote moves one across.
  let citedDelta = 0;
  let notUsefulDelta = 0;
  if (!existing) {
    if (input.used) citedDelta = 1;
    else notUsefulDelta = 1;
  } else if (existing.used !== input.used) {
    citedDelta = input.used ? 1 : -1;
    notUsefulDelta = input.used ? -1 : 1;
  }

  const [, updated] = await prisma.$transaction([
    prisma.orgMemoryCitation.upsert({
      where: { memoryId_sessionId: { memoryId, sessionId } },
      update: data,
      create: { orgId, memoryId, sessionId, ...data },
    }),
    prisma.orgMemory.update({
      where: { id: memoryId },
      data: {
        // `increment` by 0 is a no-op write rather than a branch — the shape stays one statement.
        citedCount: { increment: citedDelta },
        notUsefulCount: { increment: notUsefulDelta },
      },
      select: { citedCount: true, notUsefulCount: true },
    }),
  ]);

  return {
    outcome: existing ? (citedDelta === 0 && notUsefulDelta === 0 ? "unchanged" : "updated") : "created",
    counts: { citedCount: updated.citedCount, notUsefulCount: updated.notUsefulCount },
  };
}

/** Cited/not-useful counts for a set of memories, org-scoped. Missing ids simply do not appear —
 *  a caller must read an absent entry as "no evidence", never as "zero uses proven". */
export async function citationCountsFor(
  orgSlug: string,
  memoryIds: string[],
): Promise<Record<string, { citedCount: number; notUsefulCount: number }>> {
  if (!isDbConfigured() || memoryIds.length === 0) return {};
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};
  const rows = await getPrisma().orgMemory.findMany({
    where: { id: { in: memoryIds }, orgId },
    select: { id: true, citedCount: true, notUsefulCount: true },
  });
  const out: Record<string, { citedCount: number; notUsefulCount: number }> = {};
  for (const r of rows) out[r.id] = { citedCount: r.citedCount, notUsefulCount: r.notUsefulCount };
  return out;
}

/** The citations recorded against one memory, newest first — the evidence behind its counters. */
export async function listMemoryCitations(
  orgSlug: string,
  memoryId: string,
  limit = 50,
): Promise<MemoryCitationRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().orgMemoryCitation.findMany({
    where: { orgId, memoryId },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
  });
  // `tokenId` is deliberately absent from the wire row: which token wrote a citation is an internal
  // attribution fact the audit trail already carries, and putting it on a client type would publish
  // an identifier of a credential.
  return rows.map((r) => ({
    id: r.id,
    memoryId: r.memoryId,
    actor: r.actor,
    sessionId: r.sessionId,
    used: r.used,
    note: r.note,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }));
}
