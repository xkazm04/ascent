// A `RegistrySource` over a LOCAL git checkout of the registry — the self-hosted counterpart of
// `githubSource`. A self-hosted install with no GitHub App has no installation token to read the
// registry through, yet the registry usually sits beside the app on the same disk (`registry.local`
// in the app's own `.ai/manifest.yaml`). This reads it the way the GitHub path does: the COMMITTED
// tree of one ref, never the working tree, so an uncommitted edit in a sibling session is not indexed
// as if it had been adopted — the same "merging is adopting" rule the hosted path enforces.
//
// All git access goes through `runGit` (execFile, bounded, no shell). No token: an index pass over this
// source chains the fleet conformance sweep through each repo's PAIRED working copy instead.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "@/lib/local/git";
import type { RegistrySource } from "./index-walk";
import { MAX_FILE_BYTES, type RegistryTreeEntry } from "./read";
import type { PathCommit } from "./trace";
import { localStandardsReader } from "./conformance-sweep";

/** The branch the checkout is on, or null when detached / not a repo. */
export async function localCurrentBranch(dir: string): Promise<string | null> {
  const r = await runGit(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const name = r.stdout.trim();
  return r.ok && name ? name : null;
}

/**
 * Parse `git ls-tree -r -l -z <ref>` output. Records are NUL-separated `<mode> <type> <sha> <size>\t<path>`;
 * `-z` keeps non-ASCII paths unquoted. Non-blob records (submodule commits) are dropped.
 */
export function parseLsTree(out: string): RegistryTreeEntry[] {
  const entries: RegistryTreeEntry[] = [];
  for (const rec of out.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [, type, sha, size] = rec.slice(0, tab).trim().split(/\s+/);
    if (type !== "blob" || !sha) continue;
    entries.push({ path: rec.slice(tab + 1), type: "blob", size: Number(size) || 0, sha });
  }
  return entries;
}

export function localSource(dir: string): RegistrySource {
  return {
    async readTree(branch) {
      // The named branch when the checkout has it, else whatever HEAD is — a clone whose default
      // branch is `master` must not fail just because the row defaulted to `main`.
      const has = await runGit(dir, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]);
      const ref = has.ok ? `refs/heads/${branch}` : "HEAD";
      const head = await runGit(dir, ["rev-parse", ref]);
      if (!head.ok) throw new Error(`${dir} is not a readable git checkout (${head.stderr.trim() || "rev-parse failed"})`);
      const tree = await runGit(dir, ["ls-tree", "-r", "-l", "-z", ref], { timeoutMs: 30_000 });
      if (!tree.ok) throw new Error(`git ls-tree failed in ${dir}: ${tree.stderr.trim()}`);
      return { headSha: head.stdout.trim(), entries: parseLsTree(tree.stdout), truncated: false };
    },
    async readBlob(entry) {
      const r = await runGit(dir, ["cat-file", "blob", entry.sha]);
      if (!r.ok) throw new Error(r.stderr.trim() || "git cat-file failed");
      return r.stdout;
    },
    sweep: localStandardsReader(),
  };
}

/**
 * Commits touching `path` at `ref`, newest first — the local twin of `listPathCommits`. Same cap and
 * the same one-extra-row probe, so `truncated` means what it means on the GitHub path. `authorLogin`
 * is always null: a local commit carries an author NAME, which is an unverified string, never a login.
 */
export async function listLocalPathCommits(
  dir: string,
  path: string,
  ref: string,
  perPage: number,
): Promise<{ commits: PathCommit[]; truncated: boolean }> {
  const capped = Math.min(100, Math.max(1, perPage));
  const r = await runGit(dir, ["log", `-n${capped + 1}`, "--format=%H%x1f%aI%x1f%s%x1e", ref, "--", path]);
  if (!r.ok) throw new Error(r.stderr.trim() || "git log failed");
  const rows = r.stdout
    .split("\x1e")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sha = "", authoredAt = "", message = ""] = l.split("\x1f");
      return { sha, authoredAt: authoredAt || new Date(0).toISOString(), authorLogin: null, message };
    });
  return { commits: rows.slice(0, capped), truncated: rows.length > capped };
}

/** One file's text at a commit, or null when absent there, unreadable, or over the file cap. */
export async function readLocalFileAtRef(dir: string, path: string, ref: string): Promise<string | null> {
  const r = await runGit(dir, ["show", `${ref}:${path}`]);
  if (!r.ok || Buffer.byteLength(r.stdout) > MAX_FILE_BYTES) return null;
  return r.stdout;
}

export interface LocalRegistryTarget {
  dir: string;
  /** `owner/repo` from `registry.remote: github:owner/repo`, else the checkout's directory name under `local/`. */
  fullName: string;
}

/**
 * Where the local registry is, from the app's OWN manifest (`registry.local`, resolved against the app
 * root) — or `ASCENT_REGISTRY_LOCAL` when set. Server configuration only: a request never names a path,
 * so the route that calls this cannot be turned into an arbitrary-directory reader.
 */
export async function resolveLocalRegistry(appRoot: string = process.cwd()): Promise<LocalRegistryTarget | null> {
  const manifest = await readFile(path.join(appRoot, ".ai", "manifest.yaml"), "utf8").catch(() => "");
  const local = process.env.ASCENT_REGISTRY_LOCAL?.trim() || manifestRegistryField(manifest, "local");
  if (!local) return null;
  const dir = path.resolve(appRoot, local);
  const remote = manifestRegistryField(manifest, "remote")?.match(/^github:([\w.-]+\/[\w.-]+)$/)?.[1];
  return { dir, fullName: remote ?? `local/${path.basename(dir)}` };
}

/** One scalar under the top-level `registry:` block of an ai-manifest. A subset reader, like the registry's own. */
export function manifestRegistryField(manifest: string, key: "local" | "remote"): string | null {
  const block = manifest.match(/^registry:[ \t]*\r?\n((?:[ \t]+\S.*(?:\r?\n|$))+)/m)?.[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s+([\w-]+):\s*["']?([^"'\s#]+)/);
    if (m && m[1] === key) return m[2]!;
  }
  return null;
}
