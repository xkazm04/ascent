// Onboarding-skill generation history (STD-6). Each SKILL.md generation persists a lightweight record
// (repo, commit, the tracks it targeted, when), turning a one-off download into a tracked program: a
// repo can see how its onboarding focus shifted over time. Best-effort writes (a failed record must
// never break the file download). No-op / null when persistence is off, like the rest of src/lib/db.

import { createHash } from "node:crypto";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { listRepoProgressNotes } from "@/lib/db/repo-memory";
import { getRepositoryHistory } from "@/lib/db/scans-read";

export interface SkillGenerationRow {
  id: string;
  repoFullName: string;
  headSha: string | null;
  trackIds: string[];
  generatedAt: string;
}

function parseTrackIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Deterministic primary key for one (repo, commit, track-SET) generation — the dedup identity, made
 * atomic. Order-insensitive on the tracks (they describe a set), so the same generation always maps to
 * the SAME id and a concurrent duplicate collapses onto it via the primary-key upsert below.
 */
function generationId(repoFullName: string, headSha: string | null, trackIds: string[]): string {
  const trackKey = [...new Set(trackIds)].sort().join(",");
  const digest = createHash("sha256").update(`${repoFullName}\0${headSha ?? ""}\0${trackKey}`).digest("hex");
  return `sg_${digest.slice(0, 32)}`;
}

/**
 * Best-effort: record one skill generation. Swallows errors — the download must not depend on it.
 * Deduped ATOMICALLY (STD-6 #5): keyed on a DETERMINISTIC id over (repo, commit, track-set), the write
 * is a single primary-key `upsert` — so two concurrent generations of the identical set collapse onto
 * one row instead of the old check-then-act (findFirst → create) racing to insert duplicate no-change
 * entries. Safe/idempotent GETs (refreshes, link prefetch, CDN revalidation, bots) therefore can't
 * double-write the history even when they arrive at the same instant. `update: {}` makes the conflict
 * path a no-op, preserving the original `generatedAt` (it is the same generation, not a new one).
 */
export async function recordSkillGeneration(repoFullName: string, headSha: string | null, trackIds: string[]): Promise<void> {
  if (!isDbConfigured()) return;
  const fullName = repoFullName.slice(0, 200);
  const capped = trackIds.slice(0, 30);
  const id = generationId(fullName, headSha ?? null, capped);
  try {
    await getPrisma().skillGeneration.upsert({
      where: { id },
      update: {}, // identical (repo, commit, track-set) already recorded — no-op, no duplicate row
      create: { id, repoFullName: fullName, headSha: headSha ?? null, trackIds: JSON.stringify(capped) },
    });
  } catch {
    /* history is best-effort */
  }
}

/** A repo's recent skill generations, newest first (capped). Empty when persistence is off / none yet. */
export async function getSkillHistory(repoFullName: string, limit = 10): Promise<SkillGenerationRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().skillGeneration.findMany({
    where: { repoFullName },
    orderBy: { generatedAt: "desc" },
    take: Math.max(1, Math.min(50, limit)),
  });
  return rows.map((r) => ({
    id: r.id,
    repoFullName: r.repoFullName,
    headSha: r.headSha,
    trackIds: parseTrackIds(r.trackIds),
    generatedAt: r.generatedAt.toISOString(),
  }));
}

// ── Did the skill actually change anything? (moonshot #14) ───────────────────────────────────────
//
// `SkillGeneration` has always recorded that a SKILL.md was generated and which tracks it targeted,
// and then stopped — the row had no link to an outcome, so "we generated a skill" and "the repo got
// better" were two facts nobody joined. The onboarding skill's own protocol closes the other half:
// it tells the agent to append a `.ai/memory` PROGRESS note after every track. Once those notes are
// mirrored (RepoMemoryMirror), the join exists.
//
// HONEST NULLS, not zeros (G4): `verifiedDelta` is null — rendered "—" — whenever there is no scan
// AFTER the newest note. An unmeasured outcome is an absence, and reporting it as 0 would say "the
// skill changed nothing", which is a claim nobody made.

export interface SkillProgressNote {
  path: string;
  /** Frontmatter date, VERBATIM repo text. */
  entryDate: string | null;
  /** Track ids from THIS generation that the note's body names, by exact token match. */
  trackIds: string[];
}

export interface SkillGenerationOutcome {
  generationId: string;
  generatedAt: string;
  trackIds: string[];
  progressNotes: SkillProgressNote[];
  /** Overall-score change from the first scan AFTER the newest note. Null when unmeasured. */
  verifiedDelta: number | null;
  /** When that measuring scan ran; null when there is no post-note scan yet. */
  baselineScanAt: string | null;
}

/**
 * EXACT token match, never fuzzy. A track id is a slug, and a note that happens to contain a
 * substring of one has not reported on it — a fuzzy match here would manufacture evidence of work.
 */
export function noteMentionsTrack(body: string, trackId: string): boolean {
  if (!trackId) return false;
  const tokens = body.toLowerCase().split(/[^a-z0-9_-]+/);
  return tokens.includes(trackId.toLowerCase());
}

/**
 * Join a repo's skill generations to the progress notes its agents wrote and, where a scan has since
 * run, to the score movement that followed. Read-only: it writes nothing and records no evidence — the
 * programme ledger (#26) is a different surface with a different bar.
 *
 * `orgId` scopes the mirrored notes; `repoFullName` scopes both halves. Empty when persistence is off.
 */
export async function getSkillGenerationOutcomes(
  repoFullName: string,
  orgId: string,
): Promise<SkillGenerationOutcome[]> {
  if (!isDbConfigured() || !repoFullName || !orgId) return [];
  const [generations, notes] = await Promise.all([
    getSkillHistory(repoFullName, 20),
    listRepoProgressNotes(orgId, repoFullName, 100),
  ]);
  if (generations.length === 0) return [];

  const [owner, name] = repoFullName.split("/");
  const history =
    owner && name
      ? await getRepositoryHistory(owner, name, { limit: 50, includeDimensions: false }).catch(() => null)
      : null;
  // Oldest-first, so "the FIRST scan after t" is a find, not a scan of the whole list.
  const scans = [...(history?.scans ?? [])].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));

  return generations.map((g) => {
    const matched: SkillProgressNote[] = [];
    for (const n of notes) {
      const hits = g.trackIds.filter((t) => noteMentionsTrack(n.body, t));
      // A note written BEFORE the generation cannot be reporting on it. `lastSeenAt` is when we last
      // SAW the file, so the ordering test uses firstSeenAt — when it entered the mirror.
      if (hits.length > 0 && n.firstSeenAt >= g.generatedAt) {
        matched.push({ path: n.path, entryDate: n.entryDate, trackIds: hits });
      }
    }
    if (matched.length === 0) {
      return { generationId: g.id, generatedAt: g.generatedAt, trackIds: g.trackIds, progressNotes: [], verifiedDelta: null, baselineScanAt: null };
    }
    // The newest note is the point after which a scan can be said to have measured the work.
    const newestNote = notes
      .filter((n) => matched.some((m) => m.path === n.path))
      .reduce((a, b) => (a.firstSeenAt > b.firstSeenAt ? a : b));
    const before = [...scans].reverse().find((s) => s.scannedAt <= g.generatedAt) ?? null;
    const after = scans.find((s) => s.scannedAt > newestNote.firstSeenAt) ?? null;
    return {
      generationId: g.id,
      generatedAt: g.generatedAt,
      trackIds: g.trackIds,
      progressNotes: matched,
      // BOTH sides required. One scan is a score, not a delta.
      verifiedDelta: before && after ? after.overallScore - before.overallScore : null,
      baselineScanAt: after?.scannedAt ?? null,
    };
  });
}

/** Track-set diff between an older and newer generation: which tracks were added / dropped / kept. */
export function diffTrackSets(older: string[], newer: string[]): { added: string[]; dropped: string[]; kept: string[] } {
  const a = new Set(older);
  const b = new Set(newer);
  return {
    added: newer.filter((t) => !a.has(t)),
    dropped: older.filter((t) => !b.has(t)),
    kept: newer.filter((t) => a.has(t)),
  };
}
