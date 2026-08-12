// Regression tests for the GraphQL client's error taxonomy (ambiguity-ui-scan-2026-07-16
// github-repo-data-access #2): a rate-limited org scan must be DISTINGUISHABLE from partial data and
// from a generic failure. GitHub's GraphQL quota surfaces both as HTTP 403/429 and — trickier — as an
// HTTP 200 carrying errors[].type === "RATE_LIMITED" (sometimes alongside partial data). Both must map
// to GitHubError("RATE_LIMITED"); the partial-result path stays reserved for genuine node-level errors.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Partial mock: graphql.ts needs fetchWithTimeout/githubGraphqlUrl stubbed, but source.ts (imported
// for the GitHubError class) reads githubApiBase/githubRawBase from the same module at load time.
vi.mock(import("@/lib/github/host"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    githubGraphqlUrl: () => "https://api.github.test/graphql",
    fetchWithTimeout: vi.fn(),
  };
});

import { fetchWithTimeout } from "@/lib/github/host";
import { GitHubError } from "@/lib/github/source";
import { fetchPullRequests, type PrNode } from "./graphql";

const mockFetch = vi.mocked(fetchWithTimeout);

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

const PR: PrNode = {
  number: 1,
  title: "t",
  bodyText: "",
  isDraft: false,
  state: "MERGED",
  createdAt: "2026-01-01T00:00:00Z",
  mergedAt: "2026-01-02T00:00:00Z",
  closedAt: null,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  author: { login: "a", __typename: "User" },
  labels: { nodes: [] },
  reviews: { totalCount: 0, nodes: [] },
  comments: { totalCount: 0 },
};

function page(nodes: (PrNode | null)[], totalCount = nodes.length) {
  return { repository: { pullRequests: { totalCount, nodes, pageInfo: { hasNextPage: false, endCursor: null } } } };
}

async function caught(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return e as GitHubError;
  }
  throw new Error("expected the call to throw");
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GraphQL error taxonomy — rate-limited vs not-found vs generic", () => {
  it("classifies an HTTP 403 as RATE_LIMITED, forwarding Retry-After", async () => {
    mockFetch.mockResolvedValue(res(403, null, { "retry-after": "30" }));
    const err = await caught(fetchPullRequests("acme", "core", "tok"));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.status).toBe(403);
    expect(err.retryAfterSec).toBe(30);
  });

  it("classifies an HTTP 429 as RATE_LIMITED", async () => {
    mockFetch.mockResolvedValue(res(429, null));
    const err = await caught(fetchPullRequests("acme", "core", "tok"));
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("classifies a 200 with errors[].type RATE_LIMITED as RATE_LIMITED — even alongside partial data", async () => {
    // The in-band quota answer: HTTP 200, partial data, errors[{type:"RATE_LIMITED"}]. The old client
    // logged it as a "partial result" and returned the quota-starved slice with partial:true.
    mockFetch.mockResolvedValue(
      res(200, {
        data: page([PR]),
        errors: [{ message: "API rate limit exhausted", type: "RATE_LIMITED" }],
      }),
    );
    const err = await caught(fetchPullRequests("acme", "core", "tok"));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toMatch(/rate limit/i);
  });

  it("classifies a no-data all-NOT_FOUND response as NOT_FOUND", async () => {
    mockFetch.mockResolvedValue(
      res(200, { data: null, errors: [{ message: "Could not resolve to a Repository", type: "NOT_FOUND" }] }),
    );
    const err = await caught(fetchPullRequests("acme", "gone", "tok"));
    expect(err.code).toBe("NOT_FOUND");
  });

  it("classifies other failures as UPSTREAM (HTTP 500, and no-data generic errors)", async () => {
    mockFetch.mockResolvedValue(res(500, null));
    const err = await caught(fetchPullRequests("acme", "core", "tok"));
    expect(err.code).toBe("UPSTREAM");
    expect(err.status).toBe(500);

    mockFetch.mockResolvedValue(res(200, { data: null, errors: [{ message: "Something went wrong" }] }));
    const err2 = await caught(fetchPullRequests("acme", "core", "tok"));
    expect(err2.code).toBe("UPSTREAM");
  });

  it("keeps the partial-result path for genuine node-level errors with usable data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockResolvedValue(
      res(200, {
        data: page([PR, null], 2),
        errors: [{ message: "Could not resolve one PR node", type: "NOT_FOUND" }],
      }),
    );
    const result = await fetchPullRequests("acme", "core", "tok");
    expect(result.partial).toBe(true);
    expect(result.nodes).toHaveLength(1); // the null slot is dropped
    expect(result.totalCount).toBe(2);
    warn.mockRestore();
  });

  it("returns a clean complete result untouched (no partial flag, no throw)", async () => {
    mockFetch.mockResolvedValue(res(200, { data: page([PR]) }));
    const result = await fetchPullRequests("acme", "core", "tok");
    expect(result.partial).toBeUndefined();
    expect(result.nodes).toHaveLength(1);
  });
});

describe("PR_QUERY — the W2 trailer/pre-review fields are actually requested", () => {
  it("asks for mergeCommit message, the last 15 PR-commit messages, and review-author __typename", async () => {
    // The detection channel is only as real as the query behind it: if a refactor dropped these
    // selections, aiTrailerRate/aiPreReviewedRate would silently degrade to permanent 0/null with no
    // type error (the PrNode fields are optional for legacy-fixture compatibility). Pin the ask.
    mockFetch.mockResolvedValue(res(200, { data: page([PR]) }));
    await fetchPullRequests("acme", "core", "tok");
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string) as { query: string };
    expect(body.query).toContain("mergeCommit{ message }");
    expect(body.query).toContain("commits(last:15){ nodes{ commit{ message } } }");
    expect(body.query).toContain("reviews(first:20){ totalCount nodes{ state submittedAt author{ login __typename } } }");
  });
});
