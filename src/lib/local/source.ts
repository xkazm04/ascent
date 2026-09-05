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
import {
  GitHubError,
  MAX_FILES,
  estimateCoverage,
  pickFilesToFetch,
  quarantineMemoryFiles,
} from "@/lib/github/source";
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

/**
 * The picks the byte budget must NOT be allowed to starve. `pickFilesToFetch` reserves workflows and
 * `.ai/memory` entries a FILE-COUNT quota by appending them after the 50-slot list (github/source.ts
 * step 7/8) — which is exactly the wrong end of a sequential read that stops at MAX_TOTAL_BYTES. On a
 * worktree with a few dozen large source/test samples the budget was gone before the loop reached
 * `.github/workflows/*`, and the loop's rescan then scored "0/1 workflows" against a GitHub before-scan
 * that had read "3/3": D9 collapsed by forty points with no change to the repository (wave-2 sample).
 * The security battery, the dependency-update check, the policy check and the D1/D8 guidance
 * detectors all read these files whole, so their presence decides comparability between the two ends.
 */
export const RESERVED_PICK_RE =
  /^(\.github\/workflows\/[^/]+\.ya?ml|\.github\/dependabot\.ya?ml|\.?renovaterc(\.json)?|renovate\.json5?|security\.md|\.ai\/.+|claude\.md|agents\.md)$/i;

/**
 * Read `picks` under the byte budget with the reserved class EXEMPT from it: reserved picks are read
 * first and always kept (still capped per file), the rest fill the remaining MAX_TOTAL_BYTES in pick
 * order, and the result is restored to pick order so the prompt window is unchanged for the files
 * that were going to be read either way. Pure over the injected reader so the starvation case is a
 * unit test rather than a fixture repository.
 */
export async function readPicksWithReserve(
  picks: readonly string[],
  read: (path: string) => Promise<string | null>,
  aborted: () => boolean = () => false,
): Promise<FetchedFile[]> {
  const order = new Map(picks.map((p, i) => [p, i]));
  const reserved = picks.filter((p) => RESERVED_PICK_RE.test(p));
  const rest = picks.filter((p) => !RESERVED_PICK_RE.test(p));
  const files: FetchedFile[] = [];
  let totalBytes = 0;
  for (const path of [...reserved, ...rest]) {
    if (aborted()) break;
    const exempt = RESERVED_PICK_RE.test(path);
    if (!exempt && totalBytes >= MAX_TOTAL_BYTES) continue;
    const content = await read(path);
    if (content == null) continue; // deleted-but-tracked, unreadable, or binary-invalid — degrade coverage
    const cap = CODEOWNERS_RE.test(path) ? MAX_CODEOWNERS_BYTES : MAX_FILE_BYTES;
    const truncated = content.slice(0, cap);
    if (!exempt) totalBytes += truncated.length;
    files.push({ path, content: truncated, bytes: content.length });
  }
  return files.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0));
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
    const files = await readPicksWithReserve(
      picks,
      (path) => readFile(join(cwd, path), "utf8").catch(() => null),
      () => opts.signal?.aborted === true,
    );
    // files[] is in pick order (readPicksWithReserve restores it) — the property the prompt's byte
    // window depends on; GitHubPublicSource re-sorts because its pool fills out of order.

    // The `.ai/memory` quarantine (moonshot #14), byte-for-byte the GitHub source's: a local scan of a
    // repo with agent memory must mirror it and must ALSO keep it out of the prompt. Sharing the
    // partition function is what stops the two ingestion paths from drifting on the guarantee.
    const { files: promptFiles, memoryFiles, nonMemoryAttempted } = quarantineMemoryFiles(files, picks);

    return {
      meta,
      tree,
      files: promptFiles,
      commits,
      truncated: false,
      coverage: estimateCoverage(
        tree.length,
        promptFiles.length,
        Math.min(nonMemoryAttempted, MAX_FILES),
        false,
      ),
      memoryFiles,
    };
  }
}

/** Whether the working copy has uncommitted changes — the rescan route reads this once to phrase its
 *  disclosure caveat (the source independently re-derives it for the sha-identity decision). */
export async function isWorkingCopyDirty(root: string): Promise<boolean> {
  const res = await runGit(root, ["status", "--porcelain"]);
  return !res.ok || res.stdout.trim().length > 0;
}
