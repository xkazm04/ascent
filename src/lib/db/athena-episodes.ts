// ATHENA'S EPISODES — what she remembers about working with this org, written into the org's OWN
// memory store rather than a private table of her own.
//
// An episode is "what happened, on this date, in this conversation". OrgMemory already models
// exactly that (`kind: "episodic"`), it is already org-scoped, already searchable, already surfaced
// in the Memory tab, and already reachable by recall. A second episodic store would fork the org's
// memory in two and make "what do we know" a question with two answers.
//
// THE CONSTANTS BELOW ARE THE CONTRACT, and they are exact:
//   namespace "athena"   — her lane inside the store; also the erase predicate's companion.
//   kind      "episodic" — the taxonomy's own word for this; NOT a new kind (an unknown kind is
//                          silently coerced to "semantic" by normalizeMemoryKind).
//   source    "athena"   — provenance. It is what eraseOrgAthena sweeps on, so it must never drift.
//   createdBy null       — no human wrote this. Stamping a login would put words in someone's mouth.
//   visibility "shared"  — she is the ORG's companion; a private episode would be a mind the org
//                          cannot read, which is the opposite of what she is for.
//
// NEVER-THROWING, deliberately, exactly like writeScanMemory (src/lib/memory/scan-feed.ts:104-111):
// a memory write is a side effect of a turn, and a turn that already produced a good answer must not
// fail because the store hiccuped. Every failure is warned and swallowed, and the caller gets null.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

/** Her lane inside the org's memory store. */
export const ATHENA_MEMORY_NAMESPACE = "athena";
/** Provenance stamped on every row she writes — and the predicate eraseOrgAthena sweeps on. */
export const ATHENA_MEMORY_SOURCE = "athena";
/** The taxonomy's existing word for "what happened". Not a new kind. */
export const ATHENA_MEMORY_KIND = "episodic";
/** Bound on a single episode, matching the store's own content ceiling. */
const EPISODE_MAX_CHARS = 20_000;

export interface WriteEpisodeInput {
  orgId: string;
  /** The episode body — what happened, in prose she would say out loud. */
  content: string;
  /** Secondary refinement (thread id, action id, repo). Stored as the store's JSON string[]. */
  tags?: string[];
  /** 0..1 trust. Defaults to 1.0; lower it when she is recording something she inferred. */
  confidence?: number;
}

/**
 * Write one episode. Returns the new row's id, or null when nothing was written — including when
 * there is no database, when the body is blank, and when the store threw.
 */
export async function writeAthenaEpisode(input: WriteEpisodeInput): Promise<{ id: string } | null> {
  const content = input.content.trim().slice(0, EPISODE_MAX_CHARS);
  if (!isDbConfigured() || !input.orgId || !content) return null;
  try {
    return await getPrisma().orgMemory.create({
      data: {
        orgId: input.orgId,
        namespace: ATHENA_MEMORY_NAMESPACE,
        content,
        kind: ATHENA_MEMORY_KIND,
        visibility: "shared",
        source: ATHENA_MEMORY_SOURCE,
        confidence:
          typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1
            ? input.confidence
            : 1.0,
        tags: JSON.stringify((input.tags ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 12)),
        createdBy: null,
      },
      select: { id: true },
    });
  } catch (err) {
    console.warn(
      "[db/athena-episodes] episode write failed (caller unaffected)",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Her own recent episodes — the "what do I already know about this org" read, newest first. */
export async function listAthenaEpisodes(orgId: string, limit = 20): Promise<{ id: string; content: string; createdAt: string }[]> {
  if (!isDbConfigured() || !orgId) return [];
  try {
    const rows = await getPrisma().orgMemory.findMany({
      where: {
        orgId,
        namespace: ATHENA_MEMORY_NAMESPACE,
        source: ATHENA_MEMORY_SOURCE,
        archived: false,
        supersededBy: null,
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, Math.round(limit))),
      select: { id: true, content: true, createdAt: true },
    });
    return rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.createdAt.toISOString() }));
  } catch (err) {
    console.warn(
      "[db/athena-episodes] episode read failed (caller unaffected)",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
