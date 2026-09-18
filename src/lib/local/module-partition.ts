// HOW A REPOSITORY IS CUT INTO MODULES — the ruler an "architecture move" is measured against
// (spark theater-upgrade, 2026-09-18; WP3 implements).
//
// First hit wins, and the partition records which source said so (`ModulePartition.source`):
//   1. `context-map` — the repo's own `context-map.json` contexts (file paths → directory prefixes);
//   2. `workspace`   — package roots (npm/pnpm workspaces, go.mod directories, Cargo members);
//   3. `directory`   — directories at depth 2 under the first source root (`src/`, `lib/`, `app/`,
//                      `packages/`), else depth 1 at the repo root.
// A module is a repo-relative directory prefix WITH a trailing slash; the list is longest-first so a
// path resolves to its most specific module.

import type { ArchitectureMove, ModulePartition } from "@/lib/local/runner-types";

/** Read the partition from a checkout. STUB (WP0): an empty directory partition, which declares no module. */
export async function modulePartition(_repoDir: string): Promise<ModulePartition> {
  return { source: "directory", modules: [] };
}

/** One line of `git diff --name-status -M`, parsed. `R` carries both paths. */
export interface NameStatusEntry {
  status: "A" | "M" | "D" | "R" | "C" | "T";
  path: string;
  /** The OLD path of a rename or copy. */
  from: string | null;
}

/** Parse `git diff --name-status -M` output. STUB (WP0): nothing. */
export function parseNameStatus(_raw: string): NameStatusEntry[] {
  return [];
}

/**
 * The architecture moves a diff actually made, measured against a partition: a rename across modules is
 * a `cross-module-move`, files added under a directory the partition did not have are a `module-created`,
 * every tracked file of a module deleted is a `module-removed`. `trackedBefore` is the file list at the
 * diff's base, needed to tell "a module lost some files" from "a module is gone". STUB (WP0): none.
 */
export function movesInDiff(
  _entries: readonly NameStatusEntry[],
  _partition: ModulePartition,
  _trackedBefore: readonly string[] = [],
): ArchitectureMove[] {
  return [];
}
