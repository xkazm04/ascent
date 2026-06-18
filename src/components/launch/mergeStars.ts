import type { RepoStar } from "./fleetMapStars";

/** Merge a fresh repo set into the prior one (MAP-6 live refresh): keep the OLD object identity for
 *  any star whose score/level/movement is unchanged, so React doesn't re-animate it; swap only changed
 *  stars; append newly-appeared repos. Preserves order. Pure. */
export function mergeStars(prev: RepoStar[], fresh: RepoStar[]): RepoStar[] {
  const freshBy = new Map(fresh.map((s) => [s.fullName, s]));
  const merged = prev.map((p) => {
    const f = freshBy.get(p.fullName);
    if (!f) return p;
    freshBy.delete(p.fullName);
    return f.overall === p.overall && f.level === p.level && f.dOverall === p.dOverall && f.watched === p.watched ? p : f;
  });
  for (const f of freshBy.values()) merged.push(f); // repos that appeared since the last pull
  return merged;
}
