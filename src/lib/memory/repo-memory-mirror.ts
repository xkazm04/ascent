// `.ai/memory` COMES HOME (moonshot #14): every memory entry an agent wrote in an adopted repo becomes
// searchable org-wide, with provenance, superseding honoured, and the content held permanently behind
// the untrusted boundary.
//
// ── The one thing to keep straight about this module ─────────────────────────────────────────────
//
// It handles UNTRUSTED CONTENT: agent-written prose out of a customer repository, the textbook
// injection carrier. Three positional guarantees hold it, and only the first one lives here:
//
//   1. The bodies never enter `RepoSnapshot.files`, so they never reach `buildScanScoreInput` /
//      `buildAssessmentPrompt`. That is the quarantine in `src/lib/github/source.ts`; this module is
//      handed `snapshot.memoryFiles`, a channel nothing else reads.
//   2. They never reach `aiStandard()` — `src/lib/analyze/index.ts` is untouched, and its `.ai/memory`
//      COUNT reads the tree, not any content. The mirror feeds no score, ever.
//   3. Once in OrgMemory they inherit the store's existing boundary: `buildConsolidationPrompt` /
//      `buildReflectionPrompt` wrap all foreign content in UNTRUSTED_OPEN/CLOSE.
//
// `src/lib/memory/repo-memory-untrusted.test.ts` pins all three positionally.
//
// ── Posture ──────────────────────────────────────────────────────────────────────────────────────
//
// Same as scan-feed.ts, and for the same reason: this decorates a scan that already succeeded. It
// NEVER THROWS (a failure returns null) and it is IDEMPOTENT (the mirror ledger's content hash, then
// the ingest door's own dedup). Five gates, all fail-closed, all in order — an unmirrorable repo must
// look exactly like a repo with no memory.
//
// CONFIDENCE IS 0.6, NOT 1.0, and that is the honest half of the design. A scan-pipeline memory is
// something the platform OBSERVED. An `.ai/memory` entry is something an agent CLAIMED. Recording a
// claim in the "verified" band would poison the trust score that ranking and pruning depend on.

import {
  countMirrored,
  linkMirroredMemory,
  markSuperseded,
  resolveMirrorTarget,
  upsertMirrorEntries,
  type MirrorEntryInput,
} from "@/lib/db/repo-memory";
import { getCreditState } from "@/lib/db/credits";
import { workspaceAllowsMemory } from "@/lib/db/personal";
import { archiveOrgMemory } from "@/lib/db/org-memory";
import { writeMemoryCandidate } from "@/lib/memory/scan-feed";
import { REPO_MEMORY_SOURCE } from "@/lib/org/memory-kinds";
import { parseRepoMemoryEntries, type RepoMemoryEntry } from "@/lib/standard/memory-read";
import { selfHosted } from "@/lib/env";

/** Entries mirrored per scan. Mirrors the ingest cap so the two cannot disagree about "a scan's worth". */
export const MAX_ENTRIES_PER_SCAN = 12;
/** Live mirrored rows per (org, repo). Newest win; the overflow is RECORDED as capped, not dropped. */
export const MAX_LIVE_PER_REPO = 200;

/** The trust band a repo-authored claim is recorded at: "medium — probable, unverified". */
export const REPO_MEMORY_CONFIDENCE = 0.6;

export interface MirrorRepoMemoryInput {
  /** The org this scan belongs to. Absent/blank on an anonymous or public-funnel scan — gate 1. */
  orgSlug?: string | null;
  repoFullName: string;
  headSha?: string | null;
  /** `RepoSnapshot.memoryFiles` — the quarantined channel, never `files`. */
  memoryFiles: { path: string; content: string }[];
}

export interface MirrorRepoMemoryResult {
  mirrored: number;
  deduped: number;
  skipped: number;
  superseded: number;
}

/** The mirror's whole job, as one never-throwing call. Null = nothing was mirrorable (see the gates). */
export async function mirrorRepoMemory(
  input: MirrorRepoMemoryInput,
): Promise<MirrorRepoMemoryResult | null> {
  try {
    return await runMirror(input);
  } catch (err) {
    console.warn(
      "[memory/repo-memory-mirror] mirror failed (scan unaffected)",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function runMirror(input: MirrorRepoMemoryInput): Promise<MirrorRepoMemoryResult | null> {
  const orgSlug = (input.orgSlug ?? "").trim();
  const repoFullName = (input.repoFullName ?? "").trim();
  // GATE 1 — an org, and something to mirror. A public-funnel scan has no org to index INTO, and
  // "public" is not one: an anonymous scan must leave no trace of the repo's prose anywhere.
  if (!orgSlug || orgSlug === "public" || !repoFullName || input.memoryFiles.length === 0) return null;

  // GATE 2 — the repo must be a Repository row IN THIS ORG. An org scanning a third party's public
  // repo does not get to ingest that repo's agent prose into its own memory store. This is the tenancy
  // boundary, and it is a DB fact, never the caller's coordinate string.
  const target = await resolveMirrorTarget(orgSlug, repoFullName);
  if (!target) return null;

  // GATE 3 — the org's opt-out. null = never chosen = ON (the default the feature ships with).
  if (target.mirrorFlag === false) return null;

  // GATE 4 — the same plan gate every memory WRITE route uses. A mirrored entry is a memory write;
  // routing around the entitlement because the writer is a machine would be a back door into the
  // feature. `selfHosted()` already turns the plan half off inside planAllows, so a self-hosted
  // install passes this without a special case here.
  const credit = await getCreditState(orgSlug).catch(() => null);
  if (!(await workspaceAllowsMemory(orgSlug, credit?.plan))) return null;

  const { entries, skipped } = parseRepoMemoryEntries(input.memoryFiles);
  if (entries.length === 0) return { mirrored: 0, deduped: 0, skipped: skipped.length, superseded: 0 };

  // GATE 5 — the caps. Per scan: the newest MAX_ENTRIES_PER_SCAN. Per (org, repo): once the live count
  // is at MAX_LIVE_PER_REPO the overflow is still LEDGERED, with `skipReason: "capped"`, and simply
  // does not feed OrgMemory. A cap that deletes evidence of itself is not a cap, it is a data loss bug.
  const capped = selfHosted() ? entries : entries.slice(0, MAX_ENTRIES_PER_SCAN);
  const room = selfHosted() ? capped.length : Math.max(0, MAX_LIVE_PER_REPO - target.liveCount);

  const payload: MirrorEntryInput[] = capped.map((e, i) => ({
    path: e.path,
    contentHash: e.contentHash,
    entryId: e.entryId,
    rawKind: e.rawKind,
    mappedKind: e.mappedKind,
    scope: e.scope,
    entryDate: e.entryDate,
    supersedes: e.supersedes,
    refs: e.refs,
    body: e.body,
    headSha: input.headSha ?? null,
    // "capped" and "truncated" are different facts and both are recorded honestly: over the per-repo
    // cap, or a body the parser had to cut.
    skipReason: i >= room ? "capped" : e.truncated ? "truncated" : null,
  }));

  const rows = await upsertMirrorEntries(target.orgId, repoFullName, payload);

  let mirrored = 0;
  let deduped = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const entry = capped[i]!;
    // Only a row this scan created feeds OrgMemory. A re-seen entry already fed one (or was already
    // deduped) — re-ingesting it would rely on the door's dedup to undo our own duplicate write.
    if (!row.isNew || i >= room) continue;
    const written = await writeMemoryCandidate({
      orgId: target.orgId,
      namespace: repoFullName,
      content: memoryBody(entry, repoFullName),
      kind: entry.mappedKind,
      source: REPO_MEMORY_SOURCE,
      confidence: REPO_MEMORY_CONFIDENCE,
      tags: [repoFullName, entry.mappedKind, REPO_MEMORY_SOURCE],
    });
    if (written) {
      mirrored++;
      await linkMirroredMemory(row.id, { orgMemoryId: written.id });
    } else {
      deduped++;
      await linkMirroredMemory(row.id, { skipReason: "deduped" });
    }
  }

  // SUPERSEDING — the format's own contract ("never rewrite history; add a new file and set
  // `supersedes`"). The predecessor's mirrored row is flagged and its OrgMemory row is ARCHIVED,
  // never hard-deleted: memory.md's supersede-not-edit rule means the retired claim stays readable.
  const claims = [...new Set(capped.map((e) => e.supersedes).filter((x): x is string => Boolean(x)))];
  const retired = await markSuperseded(target.orgId, repoFullName, claims);
  for (const memoryId of retired) {
    try {
      await archiveOrgMemory(memoryId);
    } catch {
      // The ledger already says superseded; a failed archive leaves a readable row, not a wrong one.
    }
  }

  return {
    mirrored,
    deduped,
    skipped: skipped.length + Math.max(0, capped.length - room),
    superseded: retired.length,
  };
}

/**
 * The OrgMemory body for one entry. A short provenance line, then the entry VERBATIM.
 *
 * The header is deliberately outside the claim rather than woven into it: a reader (human or model)
 * scanning the store has to be able to see, without parsing, that the paragraph below is quoted from a
 * repository file and not something the org asserted. The body itself is never rewritten, summarized
 * or "cleaned" — a mirror that edits what it mirrors is not a mirror.
 */
export function memoryBody(entry: RepoMemoryEntry, repoFullName: string): string {
  const bits = [
    `From ${repoFullName} — ${entry.path}`,
    entry.rawKind ? `kind: ${entry.rawKind}` : null,
    entry.scope ? `scope: ${entry.scope}` : null,
    entry.entryDate ? `dated ${entry.entryDate}` : null,
  ].filter(Boolean);
  return `${bits.join(" · ")}\n\n${entry.body}`;
}

/** Does this org have any mirrored memory at all? The Memory tab's "render the panel" check. */
export async function hasMirroredMemory(orgSlug: string): Promise<boolean> {
  return (await countMirrored(orgSlug).catch(() => 0)) > 0;
}
