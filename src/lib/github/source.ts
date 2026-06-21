// Repo ingestion. We read a repository over the GitHub REST API (no clone, so this
// runs in a stateless serverless function). File *contents* are pulled from the raw
// host (raw.githubusercontent.com), which is not billed against the REST API rate
// limit — ideal for keyless public scans. Metadata/tree/commits use the REST API
// (3 calls), with an optional token to raise limits.

import type {
  CommitInfo,
  FetchedFile,
  RepoFile,
  RepoMeta,
  RepoSnapshot,
  ScanProgress,
} from "@/lib/types";
import { githubApiBase, githubRawBase } from "@/lib/github/host";

export type ProgressFn = (p: ScanProgress) => void;
export interface FetchOptions {
  token?: string;
  onProgress?: ProgressFn;
  /** Aborts all in-flight ingestion fetches when the client disconnects. */
  signal?: AbortSignal;
  /**
   * Git ref to ingest — a branch name, tag, or commit SHA. Defaults to the repo's default
   * branch. Set this to a PR's head SHA to score what a pull request *changes* (its tree, files,
   * and commits) rather than the default branch. `meta.defaultBranch` still reports the true
   * default; only the tree/content/commit reads are pinned to this ref.
   */
  ref?: string;
}

const API = githubApiBase();
const RAW = githubRawBase();

// Ingestion budgets — keep prompts small and avoid hammering hosts.
const MAX_FILES = 32;
const MAX_FILE_BYTES = 14_000; // truncate any single file to this many bytes
const MAX_TOTAL_BYTES = 180_000; // total content budget across all files
const COMMIT_COUNT = 30;
const TIMEOUT_API_MS = 12_000; // GitHub REST (metadata/tree/commits)
const TIMEOUT_FILE_MS = 8_000; // per-file content fetch
const FILE_CONCURRENCY = 8; // cap parallel file fetches (avoid secondary rate limits)

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export class GitHubError extends Error {
  constructor(
    public readonly code:
      | "INVALID_URL"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "UPSTREAM"
      | "EMPTY",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface RepoSource {
  fetchSnapshot(repo: ParsedRepo, opts?: FetchOptions): Promise<RepoSnapshot>;
}

/** Accepts full URLs, `github.com/owner/repo`, or bare `owner/repo`. */
export function parseRepoUrl(input: string): ParsedRepo | null {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^git@github\.com:/i, "https://github.com/");
  s = s.replace(/\.git$/i, "");

  let owner: string | undefined;
  let repo: string | undefined;

  const hadScheme = s.includes("://");
  try {
    const url = new URL(hadScheme ? s : `https://${s}`);
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      const parts = url.pathname.split("/").filter(Boolean);
      [owner, repo] = parts;
    } else if (hadScheme) {
      // An EXPLICIT URL (it carried a scheme) pointing at a non-GitHub host is not a GitHub repo
      // reference — reject it outright rather than fall through to bare-parsing its scheme/host/path
      // segments as GitHub coordinates. A scheme-less "owner/repo" shorthand still falls through to the
      // bare parser below, where the leading-dot heuristic rejects host-like inputs ("gitlab.com/a/b").
      return null;
    }
    // scheme-less, non-github "host" → fall through to the bare owner/repo shorthand parser below.
  } catch {
    // not a URL
  }

  if (!owner || !repo) {
    const parts = s.split("/").filter(Boolean);
    if (parts.length >= 2 && !parts[0]!.includes(".")) {
      [owner, repo] = parts;
    }
  }

  if (!owner || !repo) return null;
  // Basic sanitation against the GitHub name charset.
  const ok = /^[A-Za-z0-9_.-]+$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return { owner, repo };
}

function headers(token?: string, accept = "application/vnd.github+json"): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    "User-Agent": "ascent-maturity-scanner",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Encode a git ref for use in a URL while PRESERVING the slashes inside names like `release/1.2`,
 * `feature/x`, or any PR head ref. `encodeURIComponent(ref)` turns the whole ref into a single
 * literal token (`release%2F1.2`), which the trees API and raw host treat as a branch name that
 * doesn't exist — every tree/file read then 404s and the scan silently degrades to a content-less
 * report. Encoding each slash-separated segment but joining on raw `/` keeps the ref valid both as
 * a path segment and as a query value (a literal `/` is allowed in the query component).
 */
function encodeRef(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * fetch() with an AbortController timeout so no upstream call can hang the function.
 * An optional caller `signal` (the request's signal) is merged in, so the fetch is
 * aborted by whichever fires first — the per-call timeout OR a client disconnect.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    return await fetch(url, { ...init, signal: combined });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Outcome of a conditional head lookup:
 *  - `ok`         — GitHub returned the current head (200); `sha` + the response `etag`.
 *  - `unmodified` — the supplied ETag still matches (304). GitHub does NOT count a 304 against
 *                   the REST rate limit, so an unchanged repo is re-validated for free. The
 *                   caller already knows the sha (it owns the ETag), so none is echoed back.
 *  - `error`      — network/timeout/rate-limit/missing-repo; caller falls back to a SHA-less key.
 */
export type HeadLookup =
  | { status: "ok"; sha: string; etag: string | null }
  | { status: "unmodified" }
  | { status: "error" };

/**
 * Resolve the current head commit of a repo's default branch with ONE lightweight REST call,
 * optionally as a CONDITIONAL request. The `application/vnd.github.sha` media type makes GitHub
 * return just the 40-char SHA (no commit body), so this is far cheaper than the metadata/tree
 * fetch a full scan does, and `commits/HEAD` resolves the default branch without a separate
 * metadata lookup.
 *
 * Pass a prior `etag` to send `If-None-Match`: an unchanged repo answers `304 Not Modified`,
 * which GitHub does not bill against the rate limit (the same trick Dependabot/Renovate use to
 * stay within limits). That `unmodified` result is what lets a keyless re-scan of a quiet repo
 * cost zero quota. On a `200` we also capture the fresh `ETag` so the next lookup can be
 * conditional too.
 *
 * The sha keys the scan cache as `owner/repo@sha::mode`: a new push changes the SHA, so a
 * re-scan after a commit misses the cache instead of serving the pre-push report (the core
 * freshness promise of a maturity scorer). `cache: "no-store"` is load bearing — a
 * framework-cached response here would resolve a stale SHA and silently defeat invalidation
 * (and swallow the 304).
 */
export async function resolveHead(
  { owner, repo }: ParsedRepo,
  opts: { token?: string; etag?: string | null } = {},
): Promise<HeadLookup> {
  try {
    const h: Record<string, string> = {
      ...(headers(opts.token, "application/vnd.github.sha") as Record<string, string>),
    };
    if (opts.etag) h["If-None-Match"] = opts.etag;
    const res = await fetchWithTimeout(
      `${API}/repos/${owner}/${repo}/commits/HEAD`,
      { headers: h, cache: "no-store" },
      TIMEOUT_API_MS,
    );
    if (res.status === 304) return { status: "unmodified" };
    if (!res.ok) return { status: "error" };
    const sha = (await res.text()).trim();
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { status: "error" };
    return { status: "ok", sha: sha.toLowerCase(), etag: res.headers.get("etag") };
  } catch {
    return { status: "error" };
  }
}

/** Minimal repo metadata for tailoring a generated artifact (no tree/file fetch). */
export interface RepoContextMeta {
  fullName: string;
  name: string;
  description: string | null;
  primaryLanguage: string | null;
  defaultBranch: string;
}

/** One cheap metadata call → the context the practice-artifact builder tailors against. */
export async function fetchRepoContext(parsed: ParsedRepo, token?: string): Promise<RepoContextMeta> {
  const meta = mapGhRepo(await ghJson<GhRepoResponse>(`${API}/repos/${parsed.owner}/${parsed.repo}`, token));
  return {
    fullName: `${meta.owner}/${meta.name}`,
    name: meta.name,
    description: meta.description ?? null,
    primaryLanguage: meta.primaryLanguage ?? null,
    defaultBranch: meta.defaultBranch,
  };
}

/** Run `worker` over `items` with bounded concurrency. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]!, i); // safe: `i < items.length` guards the loop
    }
  });
  await Promise.all(runners);
  return results;
}

async function ghJson<T>(url: string, token?: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: headers(token), cache: "no-store" }, TIMEOUT_API_MS, signal);
  } catch (e) {
    const msg =
      (e as Error)?.name === "AbortError"
        ? "GitHub request timed out. Try again."
        : `Network error reaching GitHub: ${String(e)}`;
    throw new GitHubError("UPSTREAM", msg);
  }
  if (res.status === 404) {
    throw new GitHubError("NOT_FOUND", "Repository not found or is private.", 404);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0" || res.status === 429) {
      throw new GitHubError(
        "RATE_LIMITED",
        "GitHub API rate limit hit. Add a GITHUB_TOKEN to raise the limit, or try again later.",
        res.status,
      );
    }
    throw new GitHubError("UPSTREAM", `GitHub returned ${res.status}.`, res.status);
  }
  if (!res.ok) {
    throw new GitHubError("UPSTREAM", `GitHub returned ${res.status}.`, res.status);
  }
  return (await res.json()) as T;
}

interface GhRepoResponse {
  name: string;
  owner: { login: string };
  html_url: string;
  description: string | null;
  private: boolean;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  pushed_at: string | null;
  default_branch: string;
  size: number;
  license: { spdx_id?: string; name?: string } | null;
  topics?: string[];
}

/**
 * Single REST -> internal normalizer for a `/repos/{owner}/{repo}` response. Both the full-scan
 * snapshot (RepoMeta) and the lighter context lookup (RepoContextMeta — a projection of this)
 * derive from here, so the `default_branch` fallback and field-plucking can't drift between the
 * two call sites. `headSha` is filled in by the snapshot fetch once the tree is read.
 */
function mapGhRepo(meta: GhRepoResponse): RepoMeta {
  return {
    owner: meta.owner.login,
    name: meta.name,
    url: meta.html_url,
    description: meta.description ?? undefined,
    isPrivate: meta.private,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    primaryLanguage: meta.language ?? undefined,
    pushedAt: meta.pushed_at ?? undefined,
    defaultBranch: meta.default_branch || "main",
    sizeKb: meta.size,
    license:
      meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION"
        ? meta.license.spdx_id
        : meta.license?.name ?? undefined,
    topics: meta.topics,
  };
}

interface GhTreeResponse {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: string; size?: number; sha: string }[];
}

interface GhCommitResponse {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
  };
  author?: { login?: string } | null;
}

export class GitHubPublicSource implements RepoSource {
  async fetchSnapshot(
    { owner, repo }: ParsedRepo,
    opts: FetchOptions = {},
  ): Promise<RepoSnapshot> {
    const token = opts.token;
    const signal = opts.signal;
    const emit = opts.onProgress ?? (() => {});

    emit({ stage: "fetch", message: "Reading repository metadata…", pct: 10 });
    const metaPromise = ghJson<GhRepoResponse>(`${API}/repos/${owner}/${repo}`, token, signal);

    emit({ stage: "tree", message: "Reading file tree & recent history…", pct: 28 });
    // Recursive tree + recent commits, pinned to the ref we actually read. The trees API resolves
    // a branch name OR a commit SHA; `?sha=` scopes the commit list to the ref's history (so a
    // PR-head scan's D7 signals reflect the PR's commits), and is only sent when a ref override is
    // in play to keep default-branch scans byte-for-byte unchanged.
    //
    // When the caller already pinned a ref (a PR head SHA, or the head SHA lookupCachedScan
    // resolved for the cache key — the common case), the tree/commit reads don't depend on the
    // default branch, so they fire in PARALLEL with the metadata call instead of waiting a full
    // REST round-trip for it. Without a pinned ref we must learn the default branch from metadata
    // first, so that path stays serial.
    const treeReq = (r: string) =>
      ghJson<GhTreeResponse>(`${API}/repos/${owner}/${repo}/git/trees/${encodeRef(r)}?recursive=1`, token, signal);
    const commitsReq = (q: string) =>
      ghJson<GhCommitResponse[]>(
        `${API}/repos/${owner}/${repo}/commits?per_page=${COMMIT_COUNT}${q}`,
        token,
        signal,
      ).catch(() => [] as GhCommitResponse[]);

    let repoMeta: RepoMeta;
    let treeRes: GhTreeResponse;
    let commitsRes: GhCommitResponse[];
    if (opts.ref) {
      [repoMeta, treeRes, commitsRes] = await Promise.all([
        metaPromise.then(mapGhRepo),
        treeReq(opts.ref),
        commitsReq(`&sha=${encodeRef(opts.ref)}`),
      ]);
    } else {
      repoMeta = mapGhRepo(await metaPromise);
      [treeRes, commitsRes] = await Promise.all([treeReq(repoMeta.defaultBranch), commitsReq("")]);
    }
    // The ref actually read (tree/files/commits) — the pinned ref, else the resolved default
    // branch. `repoMeta.defaultBranch` still reports the true default for the report.
    const ref = opts.ref || repoMeta.defaultBranch;

    // The canonical head identity is the COMMIT sha (cache key, /report@sha permalinks, the
    // @@unique([repoId, headSha]) dedup), NOT treeRes.sha — that is the TREE OBJECT's sha. The commit
    // list is scoped to the read ref (the `&sha=ref` query on a pinned/PR-head scan, else the default
    // branch), so commitsRes[0] is this ref's head commit. Previously only scan.ts's default-branch
    // path corrected this; PR-gate and sha-less scans persisted the tree sha, 404-ing commit links and
    // defeating dedup. Fall back to the tree sha only when the commit list came back empty (the
    // commitsReq error path returns []), so a transient blip still yields some identity.
    repoMeta.headSha = commitsRes[0]?.sha ?? treeRes.sha;

    const tree: RepoFile[] = treeRes.tree.map((t) => ({
      path: t.path,
      type: t.type === "tree" ? "tree" : "blob",
      size: t.size,
    }));

    const blobs = tree.filter((t) => t.type === "blob");
    if (blobs.length === 0) {
      throw new GitHubError("EMPTY", "Repository appears to be empty.");
    }

    const commits: CommitInfo[] = commitsRes.map((c) => ({
      message: c.commit.message,
      authorName: c.commit.author?.name ?? undefined,
      authorLogin: c.author?.login ?? undefined,
      committedAt: c.commit.author?.date ?? undefined,
    }));

    // Fetch a budgeted set of file contents from the raw host (no API quota cost).
    const picks = pickFilesToFetch(blobs);
    emit({ stage: "files", message: `Reading ${picks.length} key files…`, pct: 45 });
    const files: FetchedFile[] = [];
    let totalBytes = 0;
    await pool(picks, FILE_CONCURRENCY, async (path) => {
      // Client disconnected mid-ingest — stop claiming budget and firing fetches for files
      // nobody will read (an already-aborted signal also makes each fetch reject immediately).
      if (signal?.aborted) return;
      // RESERVE the worst-case slice synchronously, before any await. The guard + reservation
      // run in one uninterrupted tick, so concurrent workers can't all pass a stale check and
      // overshoot the cap by ~FILE_CONCURRENCY × MAX_FILE_BYTES (the check-then-act race the
      // old code had, where the check straddled the fetch await). Reconcile to the real size
      // after the fetch resolves.
      if (totalBytes >= MAX_TOTAL_BYTES) return;
      totalBytes += MAX_FILE_BYTES; // optimistic claim
      let claimed = true;
      const releaseClaim = () => {
        if (claimed) {
          totalBytes -= MAX_FILE_BYTES;
          claimed = false;
        }
      };
      try {
        // With a token (e.g. a GitHub App installation), use the authenticated Contents
        // API so private repos work. Without one, the raw host avoids API rate limits.
        const content = token
          ? await fetchContents(owner, repo, ref, path, token, signal)
          : await fetchRaw(owner, repo, ref, path, signal);
        if (content == null) {
          releaseClaim(); // release the unused claim
          return;
        }
        const truncated = content.slice(0, MAX_FILE_BYTES);
        totalBytes += truncated.length - MAX_FILE_BYTES; // reconcile claim → actual
        claimed = false; // reconciled — no longer holding the flat optimistic claim
        files.push({ path, content: truncated, bytes: content.length });
      } catch {
        // One pathological file (bad encoding, an unexpected Contents-API shape, a non-string
        // body) must not reject the worker and, via Promise.all, abort the entire scan. Release
        // the optimistic claim and skip the file — degrade coverage, mirroring the null path.
        releaseClaim();
      }
    });
    // Order by FETCH PRIORITY (pickFilesToFetch rank), not alphabetically. The assessment prompt
    // truncates file excerpts to a byte window (buildAssessmentPrompt's OUTER cap), so whatever sorts
    // FIRST is what the model actually sees — alphabetical order buried high-signal files (README,
    // manifests, AI config, the sampled tests/source) behind the letter 'a' and let the window cut them
    // before the model ever read them. `picks` is deterministic, so ranking by it stays stable for
    // prompt/cache keying while front-loading signal. [Tiger P0-3]
    const fetchRank = new Map(picks.map((p, i) => [p, i]));
    files.sort(
      (a, b) =>
        (fetchRank.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
        (fetchRank.get(b.path) ?? Number.MAX_SAFE_INTEGER),
    );

    const coverage = estimateCoverage(blobs.length, files.length, picks.length, treeRes.truncated);

    return {
      meta: repoMeta,
      tree,
      files,
      commits,
      truncated: treeRes.truncated,
      coverage,
    };
  }
}

/** Authenticated single-file fetch via the Contents API (works for private repos). */
async function fetchContents(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const url = `${API}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeRef(branch)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: headers(token), cache: "no-store" }, TIMEOUT_FILE_MS, signal);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function fetchRaw(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${RAW}/${owner}/${repo}/${encodeRef(branch)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": "ascent-maturity-scanner" }, cache: "no-store" },
      TIMEOUT_FILE_MS,
      signal,
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Choose which files to fetch contents for, within MAX_FILES. We always grab
 * high-signal files (manifests, AI config, CI, docs) then sample a few source/test
 * files so the LLM gets a feel for the codebase.
 */
function pickFilesToFetch(blobs: RepoFile[]): string[] {
  const paths = blobs.map((b) => b.path);
  const picked = new Set<string>();

  const add = (p: string) => {
    if (picked.size < MAX_FILES) picked.add(p);
  };

  // 0. Agent-guidance files ANYWHERE in the tree — we fetch their contents to assess
  //    guidance *quality* (D1), not just presence (e.g. .claude/CLAUDE.md, nested AGENTS.md).
  paths
    .filter((p) =>
      /(^|\/)(claude\.md|agents?\.md|\.cursorrules|\.windsurfrules)$/i.test(p) ||
      /^\.github\/copilot-instructions\.md$/i.test(p) ||
      /^\.cursor\/rules\//i.test(p),
    )
    .slice(0, 4)
    .forEach(add);

  // 1. Exact high-signal filenames (root or nested).
  const exactNames = [
    "readme.md",
    "readme",
    "readme.rst",
    "claude.md",
    "agents.md",
    "agent.md",
    ".cursorrules",
    ".windsurfrules",
    ".aider.conf.yml",
    "package.json",
    "pyproject.toml",
    "go.mod",
    "cargo.toml",
    "pom.xml",
    "build.gradle",
    "gemfile",
    "composer.json",
    "tsconfig.json",
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc.json",
    ".eslintrc.js",
    "biome.json",
    "ruff.toml",
    ".pre-commit-config.yaml",
    "contributing.md",
    "security.md",
    "changelog.md",
    "codeowners",
    ".github/codeowners",
    "docs/codeowners",
    ".github/copilot-instructions.md",
    ".github/dependabot.yml",
    "renovate.json",
    ".renovaterc.json",
    "dockerfile",
    "docker-compose.yml",
    "openapi.yaml",
    "openapi.json",
    "vercel.json",
  ];
  const lowerMap = new Map(paths.map((p) => [p.toLowerCase(), p]));
  for (const name of exactNames) {
    const hit = lowerMap.get(name);
    if (hit) add(hit);
  }

  // 2. CI workflows (up to 3).
  paths
    .filter((p) => /^\.github\/workflows\/.+\.(ya?ml)$/i.test(p))
    .slice(0, 3)
    .forEach(add);

  // 3. Cursor rules dir, MCP configs.
  paths
    .filter((p) => /^\.cursor\/rules\//i.test(p) || /(^|\/)\.?mcp\.json$/i.test(p))
    .slice(0, 3)
    .forEach(add);

  // 4. ADRs / docs samples.
  paths
    .filter((p) => /^docs\/.*\.(md|mdx)$/i.test(p) || /adr.*\.(md|mdx)$/i.test(p))
    .slice(0, 3)
    .forEach(add);

  // 5. A sample of test files.
  paths
    .filter((p) =>
      /(^|\/)(__tests__|tests?|spec)\//i.test(p) ||
      /\.(test|spec)\.[a-z0-9]+$/i.test(p) ||
      /_test\.[a-z0-9]+$/i.test(p),
    )
    .slice(0, 4)
    .forEach(add);

  // 6. A sample of source files to give the LLM texture.
  paths
    .filter(
      (p) =>
        /\.(ts|tsx|js|jsx|py|go|rs|java|rb|kt|cs|php)$/i.test(p) &&
        !/(^|\/)(node_modules|dist|build|vendor|\.next)\//i.test(p) &&
        !picked.has(p),
    )
    .slice(0, 6)
    .forEach(add);

  return [...picked];
}

function estimateCoverage(totalBlobs: number, fetched: number, attempted: number, truncated: boolean): number {
  // Heuristic: how confident are we that we've seen the signal-bearing files?
  // Small repos -> high coverage; truncated giant repos -> lower.
  // Factor in the fetch SUCCESS RATE of the files we actually tried to read: a small repo used to pin
  // 0.95 regardless of how many picks failed, so a transient raw-host blip that dropped half the files
  // still read as fully covered — and the scan routes then CACHED that degraded snapshot for the full
  // TTL (their guard keys off this coverage). Scaling by fetched/attempted pushes a blip-degraded scan
  // below the cache threshold so it isn't pinned; a few legitimately-empty files barely move it.
  const fetchRate = attempted > 0 ? fetched / attempted : 1;
  let c = totalBlobs <= MAX_FILES ? 0.95 * fetchRate : Math.min(0.9, 0.4 + fetched / totalBlobs);
  if (truncated) c = Math.min(c, 0.6);
  return Math.round(c * 100) / 100;
}
