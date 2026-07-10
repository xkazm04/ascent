import type { RepoStar } from "./fleetMapStars";

/** Merge a fresh repo set into the prior one (MAP-6 live refresh): keep the OLD object identity for
 *  any star whose score/level/movement is unchanged, so React doesn't re-animate it; swap only changed
 *  stars; DROP repos that disappeared from `fresh` (deleted / unwatched upstream — otherwise a dead
 *  star with a dead report link lingers forever, since `fresh` is the full authoritative list from
 *  /api/app/repos); append newly-appeared repos. Preserves prev order. Pure. */
export function mergeStars(prev: RepoStar[], fresh: RepoStar[]): RepoStar[] {
  // An empty `fresh` almost always means a failed/parse-empty pull (mapRepos returns [] for a non-array
  // body of an otherwise-200 response), not that the org genuinely lost every repo. Nuking the whole
  // constellation on a transient blip is far worse than briefly keeping stale stars, so no-op here.
  if (fresh.length === 0) return prev;
  const freshBy = new Map(fresh.map((s) => [s.fullName, s]));
  const merged: RepoStar[] = [];
  for (const p of prev) {
    const f = freshBy.get(p.fullName);
    if (!f) continue; // gone upstream — remove the dead star instead of letting the list only ever grow
    freshBy.delete(p.fullName);
    merged.push(
      f.overall === p.overall && f.level === p.level && f.dOverall === p.dOverall && f.watched === p.watched ? p : f,
    );
  }
  for (const f of freshBy.values()) merged.push(f); // repos that appeared since the last pull
  return merged;
}
