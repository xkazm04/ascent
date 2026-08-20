// LocalFsSource — the LOCAL MODE implementation of RepoSource (self-hosted deployments only): the
// same scan pipeline, ingesting from a paired working copy on disk instead of the GitHub API.
//
// Everything downstream is unchanged by construction — analyzers, scoring, persistence and the
// follow-up trailer close (engine.ts reads `snapshot.commits[].message`, and `git log` sees LOCAL,
// UNPUSHED commits) all consume the same RepoSnapshot shape. That last property is the point of
// local mode: an `Ascent-Resolves:` trailer closes its follow-up the moment it is committed, before
// any push, so resolve→rescan is an immediate loop rather than a push-and-wait one.
//
// Identity rules (what sha the report claims):
//   - CLEAN tree  → HEAD's sha. Contents on disk ARE that commit, so the permalink/dedup identity
//     is honest and a re-scan of the same commit dedups exactly like a GitHub scan.
//   - DIRTY tree  → NO sha (a sha-less scan; the persist layer's dedupKey path already handles it).
//     We read from the working tree, so stamping HEAD's sha would assert "this content is that
//     commit" about content that provably isn't. The route surfaces the dirtiness as a caveat.
//
// File listing is `git ls-files -c -o --exclude-standard` — tracked plus unignored-untracked, which
// matches what a developer means by "my repo right now" and keeps node_modules/build output excluded
// by the repo's own ignore rules rather than by a second, drifting list here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import { GitHubError, MAX_FILES, estimateCoverage, pickFilesToFetch } from "@/lib/github/source";
import { runGit } from "@/lib/local/git";
import type { CommitInfo, FetchedFile, RepoFile, RepoMeta, RepoSnapshot } from "@/lib/types";

// Content budgets — mirror GitHubPublicSource's private caps (src/lib/github/source.ts) so a local
// scan feeds the model the same volume as a GitHub scan of the same repo; a drift here would move
// calibrated scores between the two ingestion paths for no real reason.
const MAX_FILE_BYTES = 14_000;
const MAX_CODEOWNERS_BYTES = 60_000;
const MAX_TOTAL_BYTES = 280_000;
const COMMIT_COUNT = 30;
const CODEOWNERS_RE = /(^|\/)codeowners$/i;

// git output separators: NUL between fields, RS (0x1e) between records — characters that cannot
// appear in an author name or a commit message, unlike the newline a naive `git log` parse splits on.
const FIELD_SEP = "\x00";
const RECORD_SEP = "\x1e";

/** Parse `git log --format=%H%x00%an%x00%aI%x00%B%x1e` output into CommitInfo records. */
export function parseGitLog(raw: string): CommitInfo[] {
  return raw
    .split(RECORD_SEP)
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [, author, date, message] = rec.split(FIELD_SEP);
      return {
        message: (message ?? "").trim(),
        authorName: author?.trim() || undefined,
        committedAt: date?.trim() || undefined,
      };
    });
}

export class LocalFsSource implements RepoSource {
  constructor(private readonly root: string) {}

  async fetchSnapshot(parsed: ParsedRepo, opts: FetchOptions = {}): Promise<RepoSnapshot> {
    const emit = opts.onProgress ?? (() => {});
    const cwd = this.root;
    emit({ stage: "fetch", message: "Reading the local working copy…", pct: 10 });

    // One preflight answers "is this still a repo with commits" — the pairing may have rotted since
    // it was saved (folder moved, history rewritten), and a clear error beats a git stack.
    const head = await runGit(cwd, ["rev-parse", "HEAD"]);
    if (!head.ok) {
      throw new GitHubError("NOT_FOUND", `The paired folder is not a git repository with commits (${cwd}).`);
    }
    const headSha = head.stdout.trim();

    const [statusRes, branchRes, lsRes, logRes] = await Promise.all([
      runGit(cwd, ["status", "--porcelain"]),
      runGit(cwd, ["branch", "--show-current"]),
      runGit(cwd, ["ls-files", "-z", "-c", "-o", "--exclude-standard"]),
      runGit(cwd, ["log", `-n${COMMIT_COUNT}`, "--format=%H%x00%an%x00%aI%x00%B%x1e"]),
    ]);
    const dirty = !statusRes.ok || statusRes.stdout.trim().length > 0;
    const branch = branchRes.stdout.trim() || "HEAD";

    emit({ stage: "tree", message: "Reading file tree & recent history…", pct: 28 });
    const paths = lsRes.stdout.split(FIELD_SEP).filter((p) => p.length > 0);
    const tree: RepoFile[] = paths.map((path) => ({ path: path.replace(/\\/g, "/"), type: "blob" as const }));
    if (tree.length === 0) throw new GitHubError("EMPTY", "The paired folder has no files git would track.");

    const commits = parseGitLog(logRes.stdout);

    const meta: RepoMeta = {
      owner: parsed.owner,
      name: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      stars: 0,
      forks: 0,
      defaultBranch: branch,
      // Dirty → sha-less on purpose; see the identity rules in the module header.
      ...(dirty ? {} : { headSha }),
      pushedAt: commits[0]?.committedAt,
      isPrivate: true, // a working copy is private by definition; nothing here was read from GitHub
    };

    const picks = pickFilesToFetch(tree, opts.subPath);
    emit({ stage: "files", message: `Reading ${picks.length} key files…`, pct: 45 });
    const files: FetchedFile[] = [];
    let totalBytes = 0;
    for (const path of picks) {
      if (opts.signal?.aborted) break;
      if (totalBytes >= MAX_TOTAL_BYTES) break;
      const content = await readFile(join(cwd, path), "utf8").catch(() => null);
      if (content == null) continue; // deleted-but-tracked, unreadable, or binary-invalid — degrade coverage
      const cap = CODEOWNERS_RE.test(path) ? MAX_CODEOWNERS_BYTES : MAX_FILE_BYTES;
      const truncated = content.slice(0, cap);
      totalBytes += truncated.length;
      files.push({ path, content: truncated, bytes: content.length });
    }
    // files[] is already in pick order (the sequential loop preserves it) — the property the prompt's
    // byte window depends on; GitHubPublicSource re-sorts because its pool fills out of order.

    return {
      meta,
      tree,
      files,
      commits,
      truncated: false,
      coverage: estimateCoverage(tree.length, files.length, Math.min(picks.length, MAX_FILES), false),
    };
  }
}

/** Whether the working copy has uncommitted changes — the rescan route reads this once to phrase its
 *  disclosure caveat (the source independently re-derives it for the sha-identity decision). */
export async function isWorkingCopyDirty(root: string): Promise<boolean> {
  const res = await runGit(root, ["status", "--porcelain"]);
  return !res.ok || res.stdout.trim().length > 0;
}
