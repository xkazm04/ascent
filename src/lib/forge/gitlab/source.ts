// The GitLab `Forge` — snapshot ingestion, and the record that binds the four enrichment mappers.
//
// INGESTION VOLUME IS THE CALIBRATION CONTRACT. This source reuses `pickFilesToFetch`, `MAX_FILES`,
// the per-file / total byte caps, `quarantineMemoryFiles` and `estimateCoverage` from
// `src/lib/github/source.ts` EXACTLY as `LocalFsSource` already does. That is not code-sharing for
// tidiness: the rubric was calibrated against a specific ingestion volume, so a GitLab source that
// read a different number of files, or ranked them differently, would score the same repository
// differently for reasons that have nothing to do with the repository. Sharing the budget functions is
// what makes a cross-forge score comparable at all — and `forges.md` states the limits of that claim.
//
// The `.ai/memory` quarantine (moonshot #14, carried through by ruling W4-#6) is applied here through
// the same shared partition function, so the guarantee that agent-written memory never reaches a
// prompt holds identically on every forge. A GitLab path that forgot it would be a silent prompt-
// injection surface, which is exactly why the partition is one exported symbol and not a code block.

import {
  MAX_FILES,
  MEMORY_ENTRY_RE,
  estimateCoverage,
  pickFilesToFetch,
  quarantineMemoryFiles,
} from "@/lib/github/source";
import { GitHubError } from "@/lib/forge/types";
import type {
  EnrichmentSource,
  FetchOptions,
  Forge,
  ForgeCapabilities,
  ForgeHost,
  ParsedRepo,
  RepoSource,
} from "@/lib/forge/types";
import type { CommitInfo, FetchedFile, RepoFile, RepoMeta, RepoSnapshot } from "@/lib/types";
import {
  GITLAB_TIMEOUT_FILE_MS,
  gitlabApiBase,
  gitlabGet,
  gitlabHeaders,
  gitlabPaged,
  gitlabWebBase,
  projectRef,
  type GitlabFetchOpts,
} from "@/lib/forge/gitlab/http";
import { fetchWithTimeout } from "@/lib/github/host";
import { fetchGitlabPrStats } from "@/lib/forge/gitlab/merge-requests";
import { fetchGitlabGovernance } from "@/lib/forge/gitlab/governance";
import { fetchGitlabCiHealth } from "@/lib/forge/gitlab/pipelines";
import { fetchGitlabDeployments } from "@/lib/forge/gitlab/deployments";

// Mirrors the GitHub source's private caps — see the header. A drift here moves scores.
const MAX_FILE_BYTES = 14_000;
const MAX_CODEOWNERS_BYTES = 60_000;
const MAX_TOTAL_BYTES = 280_000;
const COMMIT_COUNT = 30;
const CODEOWNERS_RE = /(^|\/)codeowners$/i;
/** Recursive tree pages (100 entries each) before the read reports itself TRUNCATED. */
const MAX_TREE_PAGES = 30;
const FILE_CONCURRENCY = 8;

interface GlProject {
  id?: number;
  name?: string;
  path_with_namespace?: string;
  description?: string | null;
  default_branch?: string | null;
  star_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  last_activity_at?: string;
  visibility?: string;
  topics?: string[];
  web_url?: string;
}

interface GlTreeEntry {
  path?: string;
  type?: string; // blob | tree
  name?: string;
}

interface GlCommit {
  id?: string;
  title?: string;
  message?: string;
  author_name?: string;
  committed_date?: string;
  created_at?: string;
}

/**
 * A GitLab coordinate. `owner` is the project's NAMESPACE PATH and `repo` its last segment, so
 * `owner/repo` reconstitutes the full path GitLab's API addresses — including subgroups
 * (`group/sub/project` → owner `group/sub`, repo `project`).
 *
 * The spec wrote "owner = top-level group", which is the same thing for the common single-level case
 * and loses the path for a nested one; a lost subgroup is a 404 on every read, so the namespace path
 * is what is carried. The persisted identity is `gitlab:group/sub/project` either way
 * (`forgeFullName`), which is why the live `@@unique([orgId, fullName])` needs no migration.
 */
export function parseGitlabUrl(input: string, host?: ForgeHost): ParsedRepo | null {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^git@([^:]+):/i, "https://$1/");
  s = s.replace(/\.git$/i, "");

  const webHost = safeHostname(gitlabWebBase(host));
  let path: string | null = null;

  if (s.includes("://")) {
    try {
      const url = new URL(s);
      const isGitlabCom = /(^|\.)gitlab\.com$/i.test(url.hostname);
      const isConfiguredHost = Boolean(webHost) && url.hostname.toLowerCase() === webHost;
      if (!isGitlabCom && !isConfiguredHost) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else {
    // Scheme-less, two accepted shapes:
    //  - a HOST-qualified path (`gitlab.com/group/project`), which GitHub's parser rejects because its
    //    first segment contains a dot — so this branch is the only thing that can claim it;
    //  - a BARE path (`group/sub/project`), which only ever reaches here through an explicit
    //    `gitlab:` prefix, because the registry offers an unprefixed bare path to GitHub FIRST and
    //    GitHub accepts every one of them. A first segment carrying a dot that ISN'T a gitlab host is
    //    refused rather than guessed at: an unknown self-hosted host is not this adapter's to claim.
    const hostQualified = /^([^/\s]+)\/(.+)$/.exec(s);
    const first = hostQualified?.[1] ?? "";
    if (first.includes(".")) {
      const isGitlabish = /(^|\.)gitlab\./i.test(first) || (Boolean(webHost) && first.toLowerCase() === webHost);
      if (!isGitlabish) return null;
      path = `/${hostQualified![2]}`;
    } else {
      path = `/${s}`;
    }
  }

  // Strip GitLab's `/-/` route separator and everything after it (`/-/tree/main`, `/-/merge_requests`),
  // then the trailing segments a pasted deep link carries.
  const cut = path.split("/-/")[0] ?? path;
  const segments = cut.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const ok = /^[A-Za-z0-9_.-]{1,100}$/;
  for (const seg of segments) {
    if (!ok.test(seg) || seg.startsWith(".") || seg.includes("..")) return null;
  }
  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join("/");
  return { owner, repo };
}

function safeHostname(base: string): string {
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** `owner/repo` reassembled — the value GitLab's API takes URL-encoded in a path position. */
export function gitlabFullPath(repo: ParsedRepo): string {
  return `${repo.owner}/${repo.repo}`;
}

export class GitLabSource implements RepoSource {
  constructor(private readonly host?: ForgeHost) {}

  async fetchSnapshot(parsed: ParsedRepo, opts: FetchOptions = {}): Promise<RepoSnapshot> {
    const emit = opts.onProgress ?? (() => {});
    const net: GitlabFetchOpts = { token: opts.token, signal: opts.signal, host: this.host };
    const fullPath = gitlabFullPath(parsed);
    const ref = projectRef(fullPath, parsed.externalId);

    emit({ stage: "fetch", message: "Reading repository metadata…", pct: 10 });
    const { body: project } = await gitlabGet<GlProject>(`/projects/${ref}`, net);
    const branch = opts.ref ?? project.default_branch ?? "main";
    if (!project.path_with_namespace) {
      throw new GitHubError("NOT_FOUND", `GitLab project not found: ${fullPath}`, 404);
    }

    emit({ stage: "tree", message: "Reading file tree & recent history…", pct: 28 });
    const [treeRes, commitRes] = await Promise.all([
      gitlabPaged<GlTreeEntry>(
        `/projects/${ref}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(branch)}`,
        MAX_TREE_PAGES,
        net,
      ),
      gitlabGet<GlCommit[]>(
        `/projects/${ref}/repository/commits?per_page=${COMMIT_COUNT}&ref_name=${encodeURIComponent(branch)}`,
        net,
      ).catch(() => null),
    ]);

    const tree: RepoFile[] = treeRes.items
      .filter((e) => typeof e.path === "string")
      .map((e) => ({ path: e.path!, type: e.type === "tree" ? ("tree" as const) : ("blob" as const) }));
    if (tree.length === 0) throw new GitHubError("EMPTY", "This GitLab project has no readable files.");

    const commits: CommitInfo[] = (commitRes?.body ?? []).map((c) => ({
      message: c.message ?? c.title ?? "",
      authorName: c.author_name,
      committedAt: c.committed_date ?? c.created_at,
    }));

    const blobs = tree.filter((f) => f.type === "blob");
    const picks = pickFilesToFetch(blobs, opts.subPath);
    emit({ stage: "files", message: `Reading ${picks.length} key files…`, pct: 45 });
    const { files: fetched, admitted } = await this.readFiles(ref, branch, picks, net);

    // THE QUARANTINE — the same partition function the GitHub and local sources use.
    // ATTEMPTED follows what the budget admitted (the GitHub source's rule); the remainder is passed
    // to estimateCoverage as its own displacement term.
    const { files, memoryFiles, nonMemoryAttempted } = quarantineMemoryFiles(fetched, admitted);
    const displacedNonMemory = picks
      .slice(admitted.length)
      .filter((p) => !MEMORY_ENTRY_RE.test(p)).length;

    const meta: RepoMeta = {
      owner: parsed.owner,
      name: parsed.repo,
      url: project.web_url ?? `${gitlabWebBase(this.host)}/${fullPath}`,
      ...(project.description ? { description: project.description } : {}),
      stars: project.star_count ?? 0,
      forks: project.forks_count ?? 0,
      ...(typeof project.open_issues_count === "number" ? { openIssues: project.open_issues_count } : {}),
      ...(project.last_activity_at ? { pushedAt: project.last_activity_at } : {}),
      defaultBranch: project.default_branch ?? branch,
      // The head COMMIT sha, never a tree sha — the identity the cache key, permalinks and the
      // `@@unique([repoId, headSha])` dedup are all built on. Absent when the commit read failed,
      // which the persist layer already handles as a sha-less scan.
      ...(commitRes?.body?.[0]?.id ? { headSha: commitRes.body[0].id } : {}),
      ...(project.topics?.length ? { topics: project.topics } : {}),
      isPrivate: project.visibility !== "public",
    };

    return {
      meta,
      tree,
      files,
      commits,
      truncated: treeRes.truncated,
      coverage: estimateCoverage(
        blobs.length,
        files.length,
        Math.min(nonMemoryAttempted, MAX_FILES),
        treeRes.truncated,
        displacedNonMemory,
      ),
      memoryFiles,
    };
  }

  /**
   * Read the picks under the same byte budget the GitHub source enforces, at the same concurrency —
   * and, like it, with an admitted set that does NOT depend on the order the lanes finish in.
   *
   * GitHub can plan the whole budget up front because its recursive tree carries `blob.size`.
   * GitLab's tree does not (`GlTreeEntry` has path/type/name and nothing else), and there is no
   * second call that would give sizes without one request per file — so the budget here can only be
   * spent against bodies we have actually read. What IS in our gift is the ORDER the budget is spent
   * in: fetches still run `FILE_CONCURRENCY`-wide, but ADMISSION is decided in strict pick order by a
   * single consumer. The admitted set is therefore exactly what a purely sequential reader would have
   * admitted — a pure function of (picks, contents) with the completion order divided out — while at
   * most `FILE_CONCURRENCY - 1` already-in-flight reads are paid for beyond it.
   *
   * Returns the admitted files (in pick order) plus the picks admission ever REACHED, so the caller's
   * coverage denominator follows the plan and the displaced remainder is disclosed, never silent.
   */
  private async readFiles(
    ref: string,
    branch: string,
    picks: string[],
    net: GitlabFetchOpts,
  ): Promise<{ files: FetchedFile[]; admitted: string[] }> {
    const base = gitlabApiBase(net.host);
    const readOne = async (path: string): Promise<string | null> => {
      const url =
        `${base}/projects/${ref}/repository/files/${encodeURIComponent(path)}/raw` +
        `?ref=${encodeURIComponent(branch)}`;
      try {
        const res = await fetchWithTimeout(
          url,
          { headers: gitlabHeaders(net.token), cache: "no-store" },
          GITLAB_TIMEOUT_FILE_MS,
          net.signal,
        );
        if (!res.ok) return null;
        return await res.text();
      } catch {
        // Degrade coverage rather than fail the scan — the GitHub source's contract exactly.
        return null;
      }
    };

    const inflight = new Map<number, Promise<string | null>>();
    const start = (i: number) => inflight.set(i, readOne(picks[i]!));
    let next = Math.min(FILE_CONCURRENCY, picks.length);
    for (let i = 0; i < next; i++) start(i);

    const out: FetchedFile[] = [];
    let totalBytes = 0;
    let i = 0;
    for (; i < picks.length; i++) {
      // The SEQUENTIAL rule, unchanged: admission closes the moment the running total reaches the cap.
      if (totalBytes >= MAX_TOTAL_BYTES) break;
      const pending = inflight.get(i);
      inflight.delete(i);
      const content = pending ? await pending : null;
      if (next < picks.length) start(next++);
      if (content == null) continue;
      const path = picks[i]!;
      const cap = CODEOWNERS_RE.test(path) ? MAX_CODEOWNERS_BYTES : MAX_FILE_BYTES;
      const truncated = content.slice(0, cap);
      totalBytes += truncated.length;
      out.push({ path, content: truncated, bytes: content.length });
    }
    // Reads already issued for displaced picks are awaited (never abandoned unhandled) and discarded.
    await Promise.allSettled([...inflight.values()]);
    // `out` is built in pick order by construction — the prompt's byte window cuts from the end, so
    // rank decides what the model actually reads.
    return { files: out, admitted: picks.slice(0, i) };
  }
}

/**
 * What GitLab can be asked. Two `false`s are the honest core of this lane:
 *
 *  - `securityPosture` — GitLab has no public equivalent of GitHub's repo-published advisories +
 *    org-level SECURITY.md pair. Its security features (SAST, dependency scanning) are pipeline jobs,
 *    already visible to the committed-file detectors, so inventing a posture record here would double
 *    count what the file battery reads. Null ⇒ the D9 platform fold is simply absent, which the
 *    additive construction makes a FLOOR, never a penalty.
 *  - `appInventory` — GitLab has no GitHub-App/check-suite concept at all. There is nothing to read.
 *
 *  `anonymous: false` is a product decision, not a technical one: gitlab.com rate-limits
 *  unauthenticated project reads hard enough that a public funnel scan would be unreliable, and an
 *  unreliable scan presented as a verdict is worse than a refusal.
 */
export const GITLAB_CAPABILITIES: ForgeCapabilities = {
  pullRequests: true,
  branchGovernance: true,
  deployments: true,
  ciHealth: true,
  securityPosture: false,
  // The OSV exposure read is GitHub-CONTENT-bound (`fetchNpmDeps` reads the lockfile over GitHub's
  // API). Wiring it to GitLab is a real feature, not a mapping — so it is honestly absent here.
  securityExposure: false,
  appInventory: false,
  codeowners: true,
  // PR-gate comments and check-run writes stay GitHub-only (dropped from this lane's scope by design):
  // a write path that half-works across forges is worse than one that is honestly absent.
  write: false,
  anonymous: false,
};

export const gitlabForge: Forge = {
  id: "gitlab",
  label: "GitLab",
  capabilities: GITLAB_CAPABILITIES,
  parseUrl: parseGitlabUrl,
  source(host?: ForgeHost): RepoSource {
    return new GitLabSource(host);
  },
  enrich(host?: ForgeHost): EnrichmentSource {
    // Signatures match `EnrichmentSource` (which mirrors the GitHub exports), so `scan-ingest.ts`
    // calls both forges identically. The absent members — securityPosture, securityExposure,
    // appInventory, commitActivity, guidanceFreshness — are the capability table above, expressed as
    // code: an absent member reaches the report as the same null a token-less GitHub scan produces.
    return {
      pullRequests: (owner, repo, token, signal) =>
        fetchGitlabPrStats(`${owner}/${repo}`, { token, signal, host }),
      branchGovernance: (owner, repo, branch, token, signal) =>
        fetchGitlabGovernance(`${owner}/${repo}`, branch, { token, signal, host }),
      ciHealth: (owner, repo, branch, token, signal) =>
        fetchGitlabCiHealth(`${owner}/${repo}`, branch, { token, signal, host }),
      deployments: (owner, repo, token) => fetchGitlabDeployments(`${owner}/${repo}`, { token, host }),
    };
  },
  permalink(repo: ParsedRepo, sha?: string): string {
    const base = `${gitlabWebBase()}/${gitlabFullPath(repo)}`;
    return sha ? `${base}/-/tree/${sha}` : base;
  },
};
