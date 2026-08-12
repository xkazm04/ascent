// GitHub GraphQL client + Pull Request ingestion.
//
// GraphQL lets us pull a page of PRs with their reviews, labels, size, and author type in
// ONE request, instead of N REST round-trips — essential for mass org scans. GraphQL has no
// anonymous access, so this requires a token; callers skip PR ingestion gracefully when none
// is available (public tokenless scans).
//
// Error taxonomy (ambiguity-ui-scan-2026-07-16 github-repo-data-access #2) — mirrors the REST layers'
// typed classification so a rate-limited org scan is distinguishable from partial data or a generic
// failure. GitHub's GraphQL rate limit surfaces TWO ways, both mapped to GitHubError("RATE_LIMITED"):
//   - transport-level: HTTP 403/429 (Retry-After forwarded as retryAfterSec when present);
//   - in-band: HTTP 200 with `errors[].type === "RATE_LIMITED"` — even alongside partial `data`,
//     because a quota-starved slice must not be cached/scored as merely "partial".
// A no-data response whose errors are all NOT_FOUND throws GitHubError("NOT_FOUND"); other failures
// throw GitHubError("UPSTREAM"). Node-level errors (a PR that failed to resolve) with usable data keep
// the partial-result path below.

import { fetchWithTimeout, githubGraphqlUrl } from "@/lib/github/host";
import { GitHubError } from "@/lib/github/source";

const GRAPHQL = githubGraphqlUrl();
// Covers the body too (host.ts fetchWithTimeout); raised accordingly — a 100-PR page with reviews
// and files is a sizable payload. W2 adds mergeCommit{message} + commits(last:15){message} per PR
// (trailer attribution) and __typename on review authors: a full 100-PR page now resolves
// ~100×(20 reviews + 10 labels + 15 commits) ≈ 4,600 nodes (≈ 46 rate-limit points, up from ~31) —
// still far under GitHub's 500k-node page budget, and the added payload is commit MESSAGES only.
const TIMEOUT_MS = 30_000;

export interface PrReview {
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submittedAt: string | null;
  /** Who submitted the review. Null for a deleted account (GitHub nulls `author` on those), so a
   *  consumer must treat "reviewed but no name" as a real, expected case rather than an error — the
   *  approval still happened. This is what makes a NAMED approver derivable at all: the aggregate
   *  rates never needed it, so the field was simply not requested.
   *  `__typename` (W2) distinguishes a Bot reviewer (an AI pre-review such as CodeRabbit / Copilot
   *  code review) from a human — optional because review nodes persisted before W2 lack it. */
  author: { login: string; __typename?: string } | null;
}

export interface PrNode {
  number: number;
  title: string;
  bodyText: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string; __typename: string } | null;
  labels: { nodes: { name: string }[] };
  reviews: { totalCount: number; nodes: PrReview[] };
  comments: { totalCount: number };
  /** The merge/squash commit's message (W2) — where a squash-merge (the dominant style) lands the PR
   *  commits' AI attribution trailers, which the title/body/label markers never see. Null on unmerged
   *  PRs; optional because pre-W2 fixtures/persisted shapes lack the key. */
  mergeCommit?: { message: string } | null;
  /** The PR's own last ≤15 commit messages (W2) — trailer attribution for rebase-merge repos, where
   *  no merge commit survives. Bounded at 15 to keep the page payload growth proportional to the
   *  trailer question, not the repo's PR depth. */
  commits?: { nodes: ({ commit: { message: string } } | null)[] };
}

export interface PullRequestsResult {
  totalCount: number;
  nodes: PrNode[];
  /**
   * True when GitHub returned `data` alongside `errors` on at least one page (some PR nodes failed
   * to resolve), so `nodes` is a silently-incomplete slice of the repo while `totalCount` still
   * reports the true repo-wide count. Omitted when the result is complete. Downstream (the maturity
   * scorer / report + the scan cache) should annotate "based on partial data" and skip caching a
   * partial result rather than presenting an under-stated score as authoritative.
   */
  partial?: boolean;
}

async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: T; partial: boolean }> {
  const res = await fetchWithTimeout(
    GRAPHQL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ascent-maturity-scanner",
      },
      body: JSON.stringify({ query, variables }),
    },
    TIMEOUT_MS,
    signal,
  );
  if (!res.ok) {
    // Transport-level classification (see the module-header taxonomy): 403/429 — or any non-OK status
    // carrying Retry-After — is the rate limit, surfaced as the same typed error the REST layer throws
    // so callers can back off / say "add a token, wait N seconds" instead of failing opaquely.
    const retryAfterRaw = res.headers.get("retry-after");
    const retryAfterSec = retryAfterRaw != null && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) : undefined;
    if (res.status === 403 || res.status === 429 || retryAfterSec !== undefined) {
      throw new GitHubError(
        "RATE_LIMITED",
        "GitHub GraphQL rate limit hit. Add a GITHUB_TOKEN with more headroom, or try again later.",
        res.status,
        retryAfterSec,
      );
    }
    throw new GitHubError("UPSTREAM", `GitHub GraphQL ${res.status}`, res.status);
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] };
  // In-band rate limit: GitHub's GraphQL quota often answers HTTP 200 with errors[].type =
  // "RATE_LIMITED" — sometimes alongside partial `data`. That is quota exhaustion, NOT node-resolution
  // noise: reinterpreting it as a "partial result" let a quota-starved PR slice be scored/cached as
  // merely thin. Classify it FIRST, before the partial-data preference below.
  if (json.errors?.some((e) => e.type === "RATE_LIMITED")) {
    throw new GitHubError(
      "RATE_LIMITED",
      `GitHub GraphQL rate limit hit: ${json.errors.map((e) => e.message).join("; ")}`,
      res.status,
    );
  }
  // GitHub GraphQL can return BOTH partial `data` AND `errors` (e.g. one PR node failed to
  // resolve). Discarding the whole response on any error throws away usable PR signals and fails
  // the scan over one bad node. Prefer partial data: throw only when there is NO data at all;
  // otherwise log the errors, flag the result as partial, and return what resolved so callers can
  // surface the gap instead of treating a degraded slice as complete.
  if (!json.data) {
    if (!json.errors?.length) throw new GitHubError("UPSTREAM", "GraphQL returned no data", res.status);
    const message = json.errors.map((e) => e.message).join("; ");
    // All-NOT_FOUND with no data = the queried resource doesn't exist (or isn't visible) — a distinct,
    // caller-actionable condition vs a generic upstream failure.
    if (json.errors.every((e) => e.type === "NOT_FOUND")) {
      throw new GitHubError("NOT_FOUND", message, res.status);
    }
    throw new GitHubError("UPSTREAM", message, res.status);
  }
  const partial = Boolean(json.errors?.length);
  if (partial) {
    console.warn(`[graphql] partial result with errors: ${json.errors!.map((e) => e.message).join("; ")}`);
  }
  return { data: json.data, partial };
}

const PR_QUERY = `query Prs($owner:String!,$repo:String!,$num:Int!,$after:String){
  repository(owner:$owner,name:$repo){
    pullRequests(first:$num, after:$after, orderBy:{field:CREATED_AT,direction:DESC}){
      totalCount
      pageInfo{ hasNextPage endCursor }
      nodes{
        number title bodyText isDraft state createdAt mergedAt closedAt
        additions deletions changedFiles
        author{ login __typename }
        labels(first:10){ nodes{ name } }
        reviews(first:20){ totalCount nodes{ state submittedAt author{ login __typename } } }
        comments{ totalCount }
        mergeCommit{ message }
        commits(last:15){ nodes{ commit{ message } } }
      }
    }
  }
}`;

// One raw page of the GraphQL `pullRequests` connection. Kept independent of PullRequestsResult (the
// aggregated return) so the connection's shape doesn't inherit the derived `partial` flag.
interface PrPage {
  totalCount: number;
  // On a partial page (node-level `errors`) GitHub nulls the individual PR elements that failed to
  // resolve — the error propagates to the nearest nullable list slot — so an element can be null
  // even though a complete connection yields PrNode. Callers must drop the nulls before use.
  nodes: (PrNode | null)[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** Shape of the PR_QUERY GraphQL `data` payload (named so the generic arg isn't an inline literal). */
interface PrQueryData {
  repository: { pullRequests: PrPage } | null;
}

/**
 * The most recent `limit` PRs (newest-first) with reviews/labels/size attached. GraphQL caps a single
 * `first:` at 100, so this walks pages with a cursor until it has `limit` nodes or the repo runs out —
 * the previous single request silently truncated at 100 for any caller asking for more (and the score
 * was then computed off a non-representative slice with no signal of the truncation). `totalCount` is
 * the repo-wide PR count (callers surface it as "N analyzed of M total"). Bounded by MAX_PAGES so a
 * pathological repo can't loop forever.
 */
export async function fetchPullRequests(
  owner: string,
  repo: string,
  token: string,
  limit = 40,
  signal?: AbortSignal,
): Promise<PullRequestsResult> {
  const target = Math.max(1, limit);
  const PER_PAGE = 100;
  const MAX_PAGES = 10; // safety bound — up to 1000 PRs even if `limit` is huge
  const nodes: PrNode[] = [];
  let totalCount = 0;
  let after: string | null = null;
  let partial = false; // any page came back with `errors` alongside `data`

  for (let page = 0; page < MAX_PAGES && nodes.length < target; page++) {
    const num = Math.min(PER_PAGE, target - nodes.length);
    const resp: { data: PrQueryData; partial: boolean } = await githubGraphql<PrQueryData>(
      token,
      PR_QUERY,
      { owner, repo, num, after },
      signal,
    );
    partial ||= resp.partial;
    const pr: PrPage | undefined = resp.data.repository?.pullRequests;
    if (!pr) {
      // Distinguish "can't see this repo's PRs" from "repo genuinely has zero PRs". GraphQL nulls
      // `repository` (or `pullRequests`) when the token lacks access to the repo, or a node-level error
      // blanked it. On the FIRST page that is NOT an empty repo: returning {totalCount:0,nodes:[]} here
      // would make the scorer treat an unreadable repo as one with zero PRs and understate its
      // review/collaboration dimension. Fail loudly so the caller (scan.ts) drops the PR-derived signals
      // (prStats=null → those dimensions are omitted) instead of scoring them as a real zero. A null on a
      // LATER page (we already accumulated nodes) just ends pagination with what we have.
      // (github-repo-data-access #3)
      if (page === 0) {
        throw new Error("GitHub GraphQL: repository PRs not readable (no access or a node-level error)");
      }
      break;
    }
    totalCount = pr.totalCount;
    // Drop the null slots a partial page leaves for the PRs that failed to resolve, so the
    // aggregated `nodes` honours its PrNode[] type and summarizePullRequests (which dereferences
    // every node) can't NPE on them. `partial` already flags the gap for the caller to surface.
    nodes.push(...pr.nodes.filter((n): n is PrNode => n != null));
    if (!pr.pageInfo?.hasNextPage || pr.nodes.length === 0) break; // last (or short) page
    after = pr.pageInfo.endCursor;
  }

  // Only carry the flag when the result is actually degraded so a complete result round-trips to the
  // legacy `{ totalCount, nodes }` shape.
  return partial ? { totalCount, nodes, partial } : { totalCount, nodes };
}
