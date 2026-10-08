// A tiny GitHub REST double for the scan routes' ambient-token tests. It answers the three endpoints
// the anonymous scan path calls before ingest (repo metadata, the default-branch head, a ref resolve)
// the way GitHub does: a PRIVATE repo is visible to a credential (the operator PAT, an installation
// token) and is a plain 404 to anyone else, which is exactly what makes "private" and "missing"
// indistinguishable without a credential.
// Conditional requests answer 304 when the If-None-Match matches the current ETag. No network.

export const PAT = "ghp_operator_pat";

export interface FakeRepo {
  private: boolean;
  head: string;
  branches?: Record<string, string>;
}

export interface FakeCall {
  path: string;
  auth: string | null;
  ifNoneMatch: string | null;
  status: number;
}

export function githubFake(
  repos: Record<string, FakeRepo>,
  opts: { failMetadata?: number } = {},
) {
  const calls: FakeCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const ifNoneMatch = headers.get("if-none-match");
    const res = answer(url.pathname, auth, ifNoneMatch);
    calls.push({ path: url.pathname, auth, ifNoneMatch, status: res.status });
    return res;
  };

  function answer(path: string, auth: string | null, ifNoneMatch: string | null): Response {
    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!m) return json(404, { message: "Not Found" });
    const [, owner, name, rest] = m;
    const repo = repos[`${owner}/${name}`.toLowerCase()];
    if (!repo || (repo.private && auth === null)) return json(404, { message: "Not Found" });

    if (rest === undefined) {
      if (opts.failMetadata) return json(opts.failMetadata, { message: "API rate limit exceeded" });
      const etag = `W/"meta-${owner}-${name}-${repo.private}"`;
      if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { etag } });
      return json(200, { name, owner: { login: owner }, private: repo.private }, { etag });
    }
    if (rest === "/commits/HEAD") {
      const etag = `"head-${repo.head}"`;
      if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(repo.head, { status: 200, headers: { etag } });
    }
    if (rest.startsWith("/commits/")) {
      const sha = repo.branches?.[decodeURIComponent(rest.slice("/commits/".length))];
      return sha ? new Response(sha, { status: 200 }) : json(404, { message: "No commit found" });
    }
    return json(404, { message: "Not Found" });
  }

  return { fetchImpl, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Everything a client can observe on a buffered response, for "answers exactly like" assertions. */
export async function observe(res: Response) {
  return { status: res.status, headers: [...res.headers.entries()], body: await res.text() };
}
