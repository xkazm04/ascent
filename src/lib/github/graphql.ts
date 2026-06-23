// GitHub GraphQL client + Pull Request ingestion.
//
// GraphQL lets us pull a page of PRs with their reviews, labels, size, and author type in
// ONE request, instead of N REST round-trips — essential for mass org scans. GraphQL has no
// anonymous access, so this requires a token; callers skip PR ingestion gracefully when none
// is available (public tokenless scans).

import { fetchWithTimeout, githubGraphqlUrl } from "@/lib/github/host";

const GRAPHQL = githubGraphqlUrl();
const TIMEOUT_MS = 15_000;

export interface PrReview {
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submittedAt: string | null;
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
}

export interface PullRequestsResult {
  totalCount: number;
  nodes: PrNode[];
}

async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
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
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  // GitHub GraphQL can return BOTH partial `data` AND `errors` (e.g. one PR node failed to
  // resolve). Discarding the whole response on any error throws away usable PR signals and fails
  // the scan over one bad node. Prefer partial data: throw only when there is NO data at all;
  // otherwise log the errors and return what resolved.
  if (!json.data) {
    throw new Error(
      json.errors?.length ? json.errors.map((e) => e.message).join("; ") : "GraphQL returned no data",
    );
  }
  if (json.errors?.length) {
    console.warn(`[graphql] partial result with errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data;
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
        reviews(first:20){ totalCount nodes{ state submittedAt } }
        comments{ totalCount }
      }
    }
  }
}`;

interface PrPage extends PullRequestsResult {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
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

  for (let page = 0; page < MAX_PAGES && nodes.length < target; page++) {
    const num = Math.min(PER_PAGE, target - nodes.length);
    const data: { repository: { pullRequests: PrPage } | null } = await githubGraphql(
      token,
      PR_QUERY,
      { owner, repo, num, after },
      signal,
    );
    const pr: PrPage | undefined = data.repository?.pullRequests;
    if (!pr) break;
    totalCount = pr.totalCount;
    nodes.push(...pr.nodes);
    if (!pr.pageInfo?.hasNextPage || pr.nodes.length === 0) break; // last (or short) page
    after = pr.pageInfo.endCursor;
  }

  return { totalCount, nodes };
}
