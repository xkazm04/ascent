// The registry's `usage/` lane, folded into the dormancy verdict — SINK B of the two-sink telemetry
// contract (#19). PURE: parsing lives in `aggregateUsage`, persistence in
// `@/lib/db/org-skill-usage-samples`, and this is only the arithmetic between them.
//
// WHY THIS LANE HAS NO REPO DIMENSION, ever. `../ai-registry/docs/usage-lane.md` forbids repository
// names, paths and per-project breakdown inside `usage/<contributor>.json`, and the registry's own
// `scripts/check-usage.mjs` enforces it on a public repo. So a sample can say "this skill ran 12 times
// for this contributor" and can never say where. The repo dimension exists on sink A (the tenant's own
// events API) or nowhere; bucketing these counts as "unattributed" would only invent a shape the data
// does not have.
//
// THE HONEST NULL THAT MATTERS: `lastUsed` is OPTIONAL in the file format. A sample without it
// contributes a COUNT and no recency, and `generatedAt` is never substituted for it. That substitution
// is the one tempting bug here — it would make every skill in an actively-regenerated registry read
// `active` forever, since the file is rewritten on every publish whether or not anyone ran anything.

import type { SkillEventStat } from "@/lib/db/org-skills";

/** One `usage/<contributor>.json` entry for one skill, as the file states it. */
export interface UsageSample {
  /** The file's stem — an installation, never a person and never a repo. */
  contributor: string;
  /** The registry skill NAME. A registry-only skill has no `OrgSkill` id, so the name is the key. */
  skillName: string;
  invokes: number;
  /** The window the contributor counted over, as it declared it. */
  windowDays: number;
  /** ISO instant of the last invocation, when the file reported one. NULL = not reported. */
  lastUsed: string | null;
  /** When the contributor generated the file. Staleness is the reader's problem — and it is NEVER a
   *  stand-in for `lastUsed`. */
  generatedAt: string;
}

/**
 * Fold samples into per-skill `invoke` stats keyed by `OrgSkill.id`.
 *
 * Matches on skill NAME because that is the only identifier the two sides share; a sample naming a
 * skill this org does not mirror is silently ignored rather than warned about, since a registry may
 * legitimately hold skills an org has not adopted.
 *
 * `lastAt` is null when no contributing sample reported a `lastUsed` — the count is real, the recency
 * is unknown, and the verdict downstream treats them as exactly that.
 */
export function sampleEventStats(
  samples: UsageSample[],
  skills: { id: string; name: string }[],
): SkillEventStat[] {
  const idByName = new Map(skills.map((s) => [s.name, s.id]));
  const byId = new Map<string, { count: number; lastAt: string | null }>();
  for (const s of samples) {
    const id = idByName.get(s.skillName);
    if (!id) continue;
    const n = Number.isFinite(s.invokes) && s.invokes > 0 ? Math.floor(s.invokes) : 0;
    const prev = byId.get(id) ?? { count: 0, lastAt: null };
    const at = s.lastUsed && Number.isFinite(Date.parse(s.lastUsed)) ? s.lastUsed : null;
    byId.set(id, {
      count: prev.count + n,
      lastAt: at && (!prev.lastAt || Date.parse(at) > Date.parse(prev.lastAt)) ? at : prev.lastAt,
    });
  }
  const out: SkillEventStat[] = [];
  for (const [skillId, v] of byId) {
    // A skill every contributor listed with zero invokes and no recency is not evidence of anything;
    // emitting a zero-count stat would only flip it out of `unmeasured` on the strength of silence.
    if (v.count === 0 && v.lastAt === null) continue;
    out.push({ skillId, type: "invoke", lastAt: v.lastAt, count: v.count });
  }
  return out.sort((a, b) => a.skillId.localeCompare(b.skillId));
}
