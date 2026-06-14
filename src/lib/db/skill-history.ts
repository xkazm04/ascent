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

/** Best-effort: record one skill generation. Swallows errors — the download must not depend on it. */
export async function recordSkillGeneration(repoFullName: string, headSha: string | null, trackIds: string[]): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await getPrisma().skillGeneration.create({
      data: { repoFullName: repoFullName.slice(0, 200), headSha: headSha ?? null, trackIds: JSON.stringify(trackIds.slice(0, 30)) },
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
