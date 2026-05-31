// GitHub GraphQL client + Pull Request ingestion.
//
// GraphQL lets us pull a page of PRs with their reviews, labels, size, and author type in
// ONE request, instead of N REST round-trips — essential for mass org scans. GraphQL has no
// anonymous access, so this requires a token; callers skip PR ingestion gracefully when none
// is available (public tokenless scans).

const GRAPHQL = "https://api.github.com/graphql";
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Merge the per-call timeout with the caller's signal (client disconnect) so the request is
  // aborted by whichever fires first.
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ascent-maturity-scanner",
      },
      body: JSON.stringify({ query, variables }),
      signal: combined,
    });
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new Error("GraphQL returned no data");
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

const PR_QUERY = `query Prs($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    pullRequests(first:$num, orderBy:{field:CREATED_AT,direction:DESC}){
      totalCount
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

/** One GraphQL request: the most recent `limit` PRs with reviews/labels/size attached. */
export async function fetchPullRequests(
  owner: string,
  repo: string,
  token: string,
  limit = 40,
  signal?: AbortSignal,
): Promise<PullRequestsResult> {
  const data = await githubGraphql<{ repository: { pullRequests: PullRequestsResult } | null }>(
    token,
    PR_QUERY,
    { owner, repo, num: Math.min(100, Math.max(1, limit)) },
    signal,
  );
  return data.repository?.pullRequests ?? { totalCount: 0, nodes: [] };
}
