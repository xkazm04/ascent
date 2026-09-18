// Where a path lives on the map — the heat map's MODULE cut, by directory prefix.
//
// The runner measures architecture against a `ModulePartition` (context map, workspace or directory),
// but the pulse does not carry it, so the map groups by what every path does carry: its folders. A
// module is the file's directory, capped at `MODULE_DEPTH` segments, so `src/scoring/claims.ts` lands
// in `src/scoring/` and a deep `src/features/inflight/live/theater/x.tsx` in `src/features/inflight/`
// (a map of a hundred one-file folders would say nothing from across the room). Files at the repo root
// share one "root" module. Pure and dependency-free.

/** Folder segments a module keeps. 3 separates `app/api/cases/` from `app/api/auth/`. */
export const MODULE_DEPTH = 3;

/** Normalise a repo-relative path: forward slashes, no leading `./` or `/`. */
export function cleanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

/** `src/scoring/claims.ts` → `src/scoring/`; `package.json` → `` (the repo root). */
export function moduleOf(path: string): string {
  const segs = cleanPath(path).split("/").filter(Boolean);
  segs.pop();
  return segs.length ? `${segs.slice(0, MODULE_DEPTH).join("/")}/` : "";
}

/** The top-level folder a module belongs to — what keeps `src/…` modules next to each other. */
export function areaOf(module: string): string {
  return module.split("/")[0] ?? "";
}

/** A module's label in two voices: the dim leading folders and the bright last one. */
export function moduleLabel(module: string): { dim: string; name: string } {
  if (!module) return { dim: "", name: "repo root" };
  const segs = module.slice(0, -1).split("/");
  const name = segs.pop() ?? "";
  return { dim: segs.length ? `${segs.join("/")}/` : "", name: `${name}/` };
}

/** `src/scoring/claims.ts` → `claims.ts`. */
export function baseName(path: string): string {
  const p = cleanPath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}
