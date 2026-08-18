// Tree selection + capped blob reading for the indexer — the PURE half of `index-registry.ts`.
//
// Kept separate because it is the part with no database and no orchestration: given a tree, which
// blobs are artifacts, and how do we read one without letting a 40MB "skill" or a 20k-file repo
// blow the request budget. That makes it directly testable from a fixture tree.

import { parseFullName, REGISTRY_DIRS, REGISTRY_PRACTICE_FILE, REGISTRY_SKILL_FILE } from "./layout";
import {
  MAX_FILE_BYTES,
  MAX_INDEXED_FILES,
  readBlob,
  readRegistryTree,
  type RegistryTree,
  type RegistryTreeEntry,
} from "./read";

/** The two GitHub reads the indexer needs, injectable so tests never touch the network. */
export interface RegistrySource {
  readTree(branch: string): Promise<RegistryTree>;
  readBlob(entry: RegistryTreeEntry): Promise<string | null>;
}

/** The default source: the installation-token GitHub read layer in ./read. */
export function githubSource(token: string, fullName: string): RegistrySource {
  const ref = parseFullName(fullName);
  if (!ref) throw new Error(`indexRegistry: "${fullName}" is not a valid owner/repo name`);
  return {
    readTree: (branch) => readRegistryTree(token, ref.owner, ref.repo, branch),
    readBlob: (entry) => readBlob(token, ref.owner, ref.repo, entry.sha),
  };
}

/** `skills/<name>/SKILL.md` and friends — exactly one directory deep, never a nested stray. */
export const isArtifact = (path: string, dir: string, file: string): boolean => {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === dir && parts[2] === file;
};

/** `memory/<kind>/<slug>.md`, excluding the generated `_index.md` and any `_`-prefixed file. */
export const isMemoryNote = (path: string): boolean => {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === REGISTRY_DIRS.memory &&
    parts[2]!.endsWith(".md") &&
    !parts[2]!.startsWith("_")
  );
};

/** Lesson entries are `## <version> - <date> - <project>` headings; the count is the lane's depth. */
export const countLessons = (text: string): number => (text.match(/^##\s+\S/gm) ?? []).length;

export interface SelectedArtifacts {
  byPath: Map<string, RegistryTreeEntry>;
  blobs: RegistryTreeEntry[];
  skills: RegistryTreeEntry[];
  practices: RegistryTreeEntry[];
  memory: RegistryTreeEntry[];
}

/**
 * Partition a tree into the three artifact lanes, path-sorted (so an index is deterministic) and
 * capped. Exceeding a cap is REPORTED into `warnings` rather than silently truncating, because a
 * silently short index is indistinguishable from a registry that lost files.
 */
export function selectArtifacts(tree: RegistryTree, warnings: string[]): SelectedArtifacts {
  const blobs = tree.entries.filter((e) => e.type === "blob");
  const take = (predicate: (p: string) => boolean, label: string) => {
    const hits = blobs.filter((b) => predicate(b.path)).sort((a, b) => a.path.localeCompare(b.path));
    if (hits.length > MAX_INDEXED_FILES) {
      warnings.push(
        `${label}: ${hits.length} files exceeds the ${MAX_INDEXED_FILES} cap — only the first ${MAX_INDEXED_FILES} were indexed`,
      );
    }
    return hits.slice(0, MAX_INDEXED_FILES);
  };
  return {
    byPath: new Map(blobs.map((b) => [b.path, b])),
    blobs,
    skills: take((p) => isArtifact(p, REGISTRY_DIRS.skills, REGISTRY_SKILL_FILE), "skills"),
    practices: take((p) => isArtifact(p, REGISTRY_DIRS.practices, REGISTRY_PRACTICE_FILE), "practices"),
    memory: take(isMemoryNote, "memory"),
  };
}

/**
 * A blob reader that enforces the size cap and turns any read failure into a warning + `null`, so
 * one unreadable file can never abort the pass.
 */
export function cappedReader(
  source: RegistrySource,
  warnings: string[],
): (entry: RegistryTreeEntry) => Promise<string | null> {
  return async (entry) => {
    if (entry.size > MAX_FILE_BYTES) {
      warnings.push(
        `${entry.path}: ${Math.round(entry.size / 1024)}KB exceeds the ${MAX_FILE_BYTES / 1024}KB cap — skipped`,
      );
      return null;
    }
    try {
      return await source.readBlob(entry);
    } catch (err) {
      warnings.push(`${entry.path}: could not be read (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  };
}
