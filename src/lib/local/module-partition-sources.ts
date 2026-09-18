// THE THREE READERS `modulePartition` tries, in order — pure over a file list and a file reader
// (spark theater-upgrade, 2026-09-18).
//
// Pure on purpose: the post-hoc fence check has to measure a diff against the partition AS IT WAS AT
// THE DIFF'S BASE, so it runs these same readers over `git ls-tree <before>` and `git show
// <before>:<path>` rather than over the working copy (which already carries the diff it is judging —
// a module the agent just deleted would otherwise vanish from the ruler that is supposed to notice).
//
// Every source filters its modules to directories that actually hold a file in the tree, so a stale
// entry in a context map or a workspace glob that matches nothing never becomes a module nobody can
// see. The repository root is never a module: a module that contains everything separates nothing.

/** Reads one repo-relative file, or null when it does not exist / cannot be read. */
export type TreeReader = (repoRelPath: string) => Promise<string | null>;

/** Forward slashes, no leading `./` or `/`, no doubled separators. */
export function normalizeRepoPath(p: string): string {
  let s = p.replace(/\\/g, "/").trim();
  while (s.startsWith("./")) s = s.slice(2);
  return s.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

/** A path as a directory PREFIX (trailing slash). "" for the root, which is never a module. */
export function asPrefix(p: string): string {
  const s = normalizeRepoPath(p);
  if (!s || s === ".") return "";
  return s.endsWith("/") ? s : `${s}/`;
}

/** The directory prefix a file sits in ("" at the root). */
export function dirOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i < 0 ? "" : file.slice(0, i + 1);
}

/** The parent of a directory prefix ("src/lib/db/" → "src/lib/", "scripts/" → ""). */
export function parentDir(prefix: string): string {
  return dirOf(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}

/** Longest first (a path resolves to its most specific module), then alphabetical. Root dropped. */
export function sortModules(mods: Iterable<string>): string[] {
  return [...new Set(mods)].filter(Boolean).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Every ancestor directory prefix of every file in the tree. */
export function dirPrefixes(tree: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of tree) {
    let i = f.indexOf("/");
    while (i >= 0) {
      out.add(f.slice(0, i + 1));
      i = f.indexOf("/", i + 1);
    }
  }
  return out;
}

const hasDotSegment = (prefix: string): boolean => prefix.split("/").some((s) => s.startsWith(".") || s === "node_modules");

// ── 1. context-map.json ──────────────────────────────────────────────────────────────────────────

interface ContextLike {
  filePaths?: unknown;
}

/** Contexts from every shape a context map is known to take: `groups[].contexts[]`, `ungrouped[]`
 *  and a flat `contexts[]`. Anything else contributes nothing. */
function collectContexts(map: unknown): ContextLike[] {
  if (!map || typeof map !== "object") return [];
  const m = map as { groups?: unknown; ungrouped?: unknown; contexts?: unknown };
  const out: ContextLike[] = [];
  const push = (list: unknown) => {
    if (Array.isArray(list)) for (const c of list) if (c && typeof c === "object") out.push(c as ContextLike);
  };
  if (Array.isArray(m.groups)) for (const g of m.groups) push((g as { contexts?: unknown } | null)?.contexts);
  push(m.ungrouped);
  push(m.contexts);
  return out;
}

/** The directory prefix of every file a context names (a path ending in `/` names a directory). */
export async function contextMapModules(tree: readonly string[], read: TreeReader): Promise<string[]> {
  const raw = await read("context-map.json");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const present = dirPrefixes(tree);
  const dirs = new Set<string>();
  for (const ctx of collectContexts(parsed)) {
    if (!Array.isArray(ctx.filePaths)) continue;
    for (const fp of ctx.filePaths) {
      if (typeof fp !== "string") continue;
      const n = normalizeRepoPath(fp);
      if (!n || n.split("/").includes("..")) continue;
      const d = n.endsWith("/") ? n : dirOf(n);
      if (d && present.has(d)) dirs.add(d);
    }
  }
  return [...dirs];
}

// ── 2. workspace roots ───────────────────────────────────────────────────────────────────────────

/** A workspace glob as a regex over directory prefixes. `*` is one segment, `**` any depth. */
function globToRegex(glob: string): RegExp {
  const g = normalizeRepoPath(glob).replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*" && g[i + 1] === "*") {
      re += ".*";
      i++;
      if (g[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}/$`);
}

/** The manifest-holding directories a set of globs selects (`!glob` excludes). */
function expandGlobs(globs: readonly string[], candidates: readonly string[]): string[] {
  const include = globs.filter((g) => !g.startsWith("!")).map(globToRegex);
  const exclude = globs.filter((g) => g.startsWith("!")).map((g) => globToRegex(g.slice(1)));
  return candidates.filter((d) => include.some((r) => r.test(d)) && !exclude.some((r) => r.test(d)));
}

const dirsHolding = (tree: readonly string[], manifest: string): string[] =>
  tree.filter((f) => f === manifest || f.endsWith(`/${manifest}`)).map(dirOf).filter(Boolean);

function npmWorkspaceGlobs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const pkg = JSON.parse(raw) as { workspaces?: unknown };
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces as { packages?: unknown } | undefined)?.packages;
    return Array.isArray(ws) ? ws.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** `packages:` list items of a pnpm-workspace.yaml. Deliberately minimal — a list of strings. */
export function pnpmWorkspaceGlobs(raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  let inPackages = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (item) out.push(item[1]!.replace(/^['"]|['"]$/g, ""));
    else if (/^\S/.test(line)) inPackages = false;
  }
  return out;
}

/** `members = [...]` inside Cargo.toml's `[workspace]` table. */
export function cargoWorkspaceGlobs(raw: string | null): string[] {
  if (!raw) return [];
  const section = /^\[workspace\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(raw)?.[1] ?? "";
  const members = /members\s*=\s*\[([\s\S]*?)\]/.exec(section)?.[1] ?? "";
  return [...members.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!);
}

export async function workspaceModules(tree: readonly string[], read: TreeReader): Promise<string[]> {
  const roots = new Set<string>();
  const pkgDirs = dirsHolding(tree, "package.json");
  const globs = [...npmWorkspaceGlobs(await read("package.json")), ...pnpmWorkspaceGlobs(await read("pnpm-workspace.yaml"))];
  for (const d of expandGlobs(globs, pkgDirs)) roots.add(d);
  // A go.mod at the ROOT is the whole repository; only nested ones cut it into modules.
  for (const d of dirsHolding(tree, "go.mod")) roots.add(d);
  for (const d of expandGlobs(cargoWorkspaceGlobs(await read("Cargo.toml")), dirsHolding(tree, "Cargo.toml"))) roots.add(d);
  return [...roots].filter((d) => d && !hasDotSegment(d));
}

// ── 3. directories ───────────────────────────────────────────────────────────────────────────────

/** The first existing source root, in this order. */
export const SOURCE_ROOTS = ["src/", "lib/", "app/", "packages/"] as const;

/** Directory prefixes exactly `depth` segments below `base`, among files that sit deeper still. */
function dirsAtDepth(tree: readonly string[], base: string, depth: number): string[] {
  const out = new Set<string>();
  for (const f of tree) {
    if (!f.startsWith(base)) continue;
    const segs = f.slice(base.length).split("/");
    if (segs.length <= depth) continue; // the last segment is the file name
    const prefix = `${base}${segs.slice(0, depth).join("/")}/`;
    if (!hasDotSegment(prefix)) out.add(prefix);
  }
  return [...out];
}

/** Depth 2 under the first source root (depth 1 there when it has no deeper directories), else
 *  depth 1 at the repository root. Dot-directories are never modules. */
export function directoryModules(tree: readonly string[]): string[] {
  const root = SOURCE_ROOTS.find((r) => tree.some((f) => f.startsWith(r)));
  if (root) {
    const two = dirsAtDepth(tree, root, 2);
    if (two.length) return two;
    const one = dirsAtDepth(tree, root, 1);
    if (one.length) return one;
  }
  return dirsAtDepth(tree, "", 1);
}
