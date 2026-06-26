// Onboarding-skill generation history (STD-6). Each SKILL.md generation persists a lightweight record
// (repo, commit, the tracks it targeted, when), turning a one-off download into a tracked program: a
// repo can see how its onboarding focus shifted over time. Best-effort writes (a failed record must
// never break the file download). No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

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

/** True when two track-id lists describe the same set (order-insensitive). */
function sameTrackSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((t) => seen.has(t));
}

/**
 * Best-effort: record one skill generation. Swallows errors — the download must not depend on it.
 * Deduped: skips the insert when the most-recent row for the same (repo, commit) already has the
 * identical track set, so safe/idempotent GETs (refreshes, link prefetch, CDN revalidation, bots)
 * can't fill the STD-6 history with duplicate no-change entries.
 */
export async function recordSkillGeneration(repoFullName: string, headSha: string | null, trackIds: string[]): Promise<void> {
  if (!isDbConfigured()) return;
  const fullName = repoFullName.slice(0, 200);
  const capped = trackIds.slice(0, 30);
  try {
    const latest = await getPrisma().skillGeneration.findFirst({
      where: { repoFullName: fullName, headSha: headSha ?? null },
      orderBy: { generatedAt: "desc" },
    });
    if (latest && sameTrackSet(parseTrackIds(latest.trackIds), capped)) return;
    await getPrisma().skillGeneration.create({
      data: { repoFullName: fullName, headSha: headSha ?? null, trackIds: JSON.stringify(capped) },
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
