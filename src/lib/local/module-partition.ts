// HOW A REPOSITORY IS CUT INTO MODULES — the ruler an "architecture move" is measured against
// (spark theater-upgrade, 2026-09-18; WP3).
//
// First hit wins, and the partition records which source said so (`ModulePartition.source`):
//   1. `context-map` — the repo's own `context-map.json` contexts (every file path → its directory);
//   2. `workspace`   — package roots (npm/pnpm workspaces, nested go.mod directories, Cargo members);
//   3. `directory`   — directories at depth 2 under the first source root (`src/`, `lib/`, `app/`,
//                      `packages/`), else depth 1 at the repo root.
// A module is a repo-relative directory prefix WITH a trailing slash; the list is longest-first so a
// path resolves to its most specific module. The readers live in module-partition-sources.ts.
//
// WHAT A DIFF'S ARCHITECTURE MOVES ARE (`movesInDiff`), exactly:
//   • cross-module-move — a rename whose old path resolves to module A and new path to module B ≠ A,
//     both existing. A rename where either side resolves to NO module is not an architecture move (a
//     loose file at a root is not a module, and holding every README move would be gate fatigue).
//   • module-created — a file added (A, a copy's destination, or a rename's destination) under a NEW
//     directory N: N held no file before, N is neither a module nor an ancestor of one, and N is a
//     direct child of a directory that already parents a module — i.e. N is a new PEER of existing
//     modules. A new directory inside a LEAF module (one with no child modules) is that module's
//     internal structure, not a new module. Dot-directories never count.
//   • module-removed — every file that resolved to module M before the diff (per `trackedBefore`) was
//     deleted or renamed away, and M held at least one.
//   • module-split — one existing module's files are renamed into ≥ 2 distinct NEW modules: one move
//     per (source, new module) pair. module-merged — ≥ 2 existing modules' files are renamed into one
//     NEW module: one move per (source, new module) pair. The new modules are ALSO reported as
//     `module-created`; a declared split/merge covers that creation (see lane-plan-classify.ts).
// A rename into a single new module from a single source is `module-created` only — extracting code
// into a new module is the creation, and it is not double-reported as a cross-module move.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "@/lib/local/git";
import type { ArchitectureMove, ModulePartition } from "@/lib/local/runner-types";
import {
  asPrefix,
  contextMapModules,
  dirPrefixes,
  directoryModules,
  normalizeRepoPath,
  parentDir,
  sortModules,
  workspaceModules,
  type TreeReader,
} from "@/lib/local/module-partition-sources";

export { asPrefix, normalizeRepoPath } from "@/lib/local/module-partition-sources";

/** Cut a tree into modules. Pure over the file list and the reader — see the sources module. */
export async function partitionFromTree(files: readonly string[], read: TreeReader): Promise<ModulePartition> {
  const tree = files.map(normalizeRepoPath).filter(Boolean);
  const ctx = await contextMapModules(tree, read);
  if (ctx.length) return { source: "context-map", modules: sortModules(ctx) };
  const ws = await workspaceModules(tree, read);
  if (ws.length) return { source: "workspace", modules: sortModules(ws) };
  return { source: "directory", modules: sortModules(directoryModules(tree)) };
}

const SKIP_WALK = new Set(["node_modules", ".git"]);
const WALK_CAP = 50_000;

/** Tracked files when `repoDir` is a git checkout, else a bounded filesystem walk. */
async function listRepoFiles(repoDir: string): Promise<string[]> {
  const listed = await runGit(repoDir, ["ls-files", "-z"]);
  if (listed.ok) return listed.stdout.split("\0").filter(Boolean);
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    if (out.length >= WALK_CAP) return;
    const entries = await readdir(join(repoDir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (SKIP_WALK.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  await walk("");
  return out;
}

/** Read the partition from a checkout (its tracked files, or its files when it is not a repo). */
export async function modulePartition(repoDir: string): Promise<ModulePartition> {
  const files = await listRepoFiles(repoDir);
  return partitionFromTree(files, (rel) => readFile(join(repoDir, rel), "utf8").catch(() => null));
}

/** The module a path resolves to (longest prefix), or null when no module contains it. */
export function moduleOf(partition: ModulePartition, path: string): string | null {
  const p = normalizeRepoPath(path);
  for (const m of partition.modules) if (p.startsWith(m) || asPrefix(p) === m) return m;
  return null;
}

/** One line of `git diff --name-status -M`, parsed. `R` carries both paths. */
export interface NameStatusEntry {
  status: "A" | "M" | "D" | "R" | "C" | "T";
  path: string;
  /** The OLD path of a rename or copy. */
  from: string | null;
}

const KNOWN = new Set(["A", "M", "D", "R", "C", "T"]);

/** Undo git's C-style quoting of an unusual path (`"a\tb"`). */
function unquote(p: string): string {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p;
  return p.slice(1, -1).replace(/\\(["\\tn])/g, (_m, c: string) => (c === "t" ? "\t" : c === "n" ? "\n" : c));
}

/**
 * Parse `git diff --name-status -M` output — the line format (`R087\told\tnew`) or the `-z` format
 * (NUL-separated fields, which is what the fence check asks for so no path is ever quoted). Unknown
 * status letters (U, X, B) are skipped rather than guessed at.
 */
export function parseNameStatus(raw: string): NameStatusEntry[] {
  const out: NameStatusEntry[] = [];
  const push = (code: string, a: string | undefined, b: string | undefined): void => {
    const status = code.trim()[0];
    if (!status || !KNOWN.has(status) || !a) return;
    if (status === "R" || status === "C") {
      if (!b) return;
      out.push({ status, path: normalizeRepoPath(unquote(b)), from: normalizeRepoPath(unquote(a)) });
    } else {
      out.push({ status: status as NameStatusEntry["status"], path: normalizeRepoPath(unquote(a)), from: null });
    }
  };
  if (raw.includes("\0")) {
    const f = raw.split("\0");
    for (let i = 0; i < f.length; ) {
      const code = f[i] ?? "";
      if (!code) {
        i++;
        continue;
      }
      const two = code[0] === "R" || code[0] === "C";
      push(code, f[i + 1], two ? f[i + 2] : undefined);
      i += two ? 3 : 2;
    }
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [code = "", a, b] = line.split("\t");
    push(code, a, b);
  }
  return out;
}

/**
 * The architecture moves a diff actually made, measured against a partition (the header states the
 * exact rules). `trackedBefore` is the file list at the diff's base — it is what tells "a module lost
 * some files" from "a module is gone", and "a new directory" from "a directory that was already there".
 */
export function movesInDiff(
  entries: readonly NameStatusEntry[],
  partition: ModulePartition,
  trackedBefore: readonly string[] = [],
): ArchitectureMove[] {
  const part: ModulePartition = { ...partition, modules: sortModules(partition.modules) };
  const modSet = new Set(part.modules);
  const parents = new Set(part.modules.map(parentDir));
  const ancestors = new Set<string>();
  for (const m of part.modules) for (const d of dirPrefixes([m.slice(0, -1)])) if (d !== m) ancestors.add(d);
  const before = trackedBefore.map(normalizeRepoPath).filter(Boolean);
  const beforeDirs = dirPrefixes(before);

  /** The NEW module a path lands in, or null (see the header's module-created rule). */
  const newModuleFor = (path: string): string | null => {
    const segs = normalizeRepoPath(path).split("/");
    segs.pop();
    let prefix = "";
    for (const s of segs) {
      const n = `${prefix}${s}/`;
      if (modSet.has(n) || ancestors.has(n)) {
        prefix = n;
        continue;
      }
      if (s.startsWith(".") || s === "node_modules") return null;
      return parents.has(prefix) && !beforeDirs.has(n) ? n : null;
    }
    return null;
  };

  const created = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const cross = new Map<string, ArchitectureMove>();
  const gone = new Set<string>();
  for (const e of entries) {
    if (e.status === "A" || e.status === "C") {
      const n = newModuleFor(e.path);
      if (n) created.add(n);
    } else if (e.status === "D") {
      gone.add(normalizeRepoPath(e.path));
    } else if (e.status === "R" && e.from) {
      gone.add(normalizeRepoPath(e.from));
      const a = moduleOf(part, e.from);
      const n = newModuleFor(e.path);
      if (n) {
        created.add(n);
        if (a) edges.set(a, (edges.get(a) ?? new Set()).add(n));
        continue;
      }
      const b = moduleOf(part, e.path);
      if (a && b && a !== b) cross.set(`${a}\0${b}`, { kind: "cross-module-move", from: a, to: b });
    }
  }

  const tally = new Map<string, { total: number; gone: number }>();
  for (const f of before) {
    const m = moduleOf(part, f);
    if (!m) continue;
    const t = tally.get(m) ?? { total: 0, gone: 0 };
    t.total++;
    if (gone.has(f)) t.gone++;
    tally.set(m, t);
  }

  const byName = (a: ArchitectureMove, b: ArchitectureMove) =>
    `${a.from ?? ""}\0${a.to ?? ""}`.localeCompare(`${b.from ?? ""}\0${b.to ?? ""}`);
  const out: ArchitectureMove[] = [];
  out.push(...[...created].sort().map((to): ArchitectureMove => ({ kind: "module-created", from: null, to })));
  out.push(
    ...[...tally.entries()]
      .filter(([, t]) => t.total > 0 && t.gone === t.total)
      .map(([from]): ArchitectureMove => ({ kind: "module-removed", from, to: null }))
      .sort(byName),
  );
  const split: ArchitectureMove[] = [];
  const intoNew = new Map<string, Set<string>>();
  for (const [a, ns] of edges) {
    for (const n of ns) intoNew.set(n, (intoNew.get(n) ?? new Set()).add(a));
    if (ns.size >= 2) for (const n of ns) split.push({ kind: "module-split", from: a, to: n });
  }
  out.push(...split.sort(byName));
  const merged: ArchitectureMove[] = [];
  for (const [n, froms] of intoNew) if (froms.size >= 2) for (const a of froms) merged.push({ kind: "module-merged", from: a, to: n });
  out.push(...merged.sort(byName));
  out.push(...[...cross.values()].sort(byName));
  return out;
}
