// listOrgRepos must (a) paginate across the Link header to backfill slots lost to fork/archived
// filtering, and (b) surface a rate-limit / auth failure as a TYPED error rather than masking it as a
// 404 "no such org". Plus the handle/name validators that guard the untrusted import `repos[]` path.

import { describe, it, expect, vi, afterEach } from "vitest";
import { listOrgRepos, isValidHandle, isValidRepoName, GitHubListError } from "./list";

function ghRepo(name: string, opts: { fork?: boolean; archived?: boolean } = {}) {
  return {
    name,
    full_name: `acme/${name}`,
    owner: { login: "acme" },
    html_url: `https://github.com/acme/${name}`,
    fork: !!opts.fork,
    archived: !!opts.archived,
    private: false,
    stargazers_count: 0,
    pushed_at: "2026-01-01T00:00:00Z",
    description: null,
  };
}

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  const h = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("isValidHandle / isValidRepoName", () => {
  it("handles: real logins pass; traversal / dots / empty are rejected", () => {
    expect(isValidHandle("facebook")).toBe(true);
    expect(isValidHandle("../x")).toBe(false);
    expect(isValidHandle("a.b")).toBe(false); // dots aren't valid in a login
    expect(isValidHandle("")).toBe(false);
  });

  it("repo names: dots allowed; traversal / leading-dot rejected", () => {
    expect(isValidRepoName("repo.js")).toBe(true);
    expect(isValidRepoName("my-repo")).toBe(true);
    expect(isValidRepoName("../x")).toBe(false);
    expect(isValidRepoName(".git")).toBe(false);
    expect(isValidRepoName("a..b")).toBe(false);
  });
});

describe("listOrgRepos — pagination backfill", () => {
  it("follows Link rel=next to backfill past filtered forks/archived", async () => {
    const page1 = [ghRepo("f1", { fork: true }), ghRepo("a1"), ghRepo("ar", { archived: true })];
    const page2 = [ghRepo("a2"), ghRepo("a3")];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(page1, { headers: { link: '<https://api.github.com/orgs/acme/repos?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(res(page2));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("acme", 3);
    expect(out.repos.map((r) => r.name)).toEqual(["a1", "a2", "a3"]); // forks/archived dropped, backfilled from page 2
    expect(out.truncated).toBe(false); // `count` was reached — a complete answer
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as `count` is reached without fetching further pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res([ghRepo("a1"), ghRepo("a2"), ghRepo("a3")], { headers: { link: '<x?page=2>; rel="next"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("acme", 2);
    expect(out.repos).toHaveLength(2);
    expect(out.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // github-repo-data-access (2026-07-16) #5: exhausting the MAX_LIST_PAGES budget with more pages
  // available used to hand back a short list indistinguishable from "the org has only these repos".
  it("flags `truncated` when the page budget runs out with a next page still advertised", async () => {
    // 5 pages (the whole budget), every repo a fork, every page advertising another page.
    const forkPage = [ghRepo("f", { fork: true })];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res(forkPage, { headers: { link: '<https://api.github.com/orgs/acme/repos?page=n>; rel="next"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("acme", 3);
    expect(out.repos).toEqual([]); // everything filtered, budget exhausted
    expect(out.truncated).toBe(true); // "we stopped looking", NOT "the org is empty"
    expect(fetchMock).toHaveBeenCalledTimes(5); // MAX_LIST_PAGES
  });

  it("does NOT flag `truncated` when pages genuinely run out (no rel=next on the last page)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res([ghRepo("a1")], { headers: { link: '<x?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(res([ghRepo("a2")])); // last page: no next link
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("acme", 5);
    expect(out.repos.map((r) => r.name)).toEqual(["a1", "a2"]);
    expect(out.truncated).toBe(false); // fewer than count, but the org really ended
  });
});

describe("listOrgRepos — typed error mapping", () => {
  it("throws RATE_LIMITED (not NOT_FOUND) on a 403 with x-ratelimit-remaining 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(res({}, { status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "42" } })),
    );
    await expect(listOrgRepos("acme", 5)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 42 });
  });

  it("falls back from an org 404 to the user path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({}, { status: 404 })) // /orgs/ → not an org
      .mockResolvedValueOnce(res([ghRepo("u1")])); // /users/ → ok
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("someuser", 5);
    expect(out.repos.map((r) => r.name)).toEqual(["u1"]);
  });

  it("rejects an invalid handle before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listOrgRepos("../x", 5)).rejects.toBeInstanceOf(GitHubListError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SSO / ORG-RESTRICTED TOKEN FALLBACK.
//
// A fine-grained PAT — or a classic one under an org's SAML enforcement — is authorized only for the
// orgs it was granted. Listing a DIFFERENT public org with it returns 403, while the identical
// request ANONYMOUSLY returns 200, because the repos are public. Before the fallback, a user whose
// token was scoped to their own org could not scan any public org at all: the import aborted with
// "GitHub denied listing", on data that needs no credential. Observed live on 2026-08-14 seeding
// `vercel` with two different working tokens, both 403, anonymous 200.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("listOrgRepos — SSO-restricted token falls back to anonymous", () => {
  it("retries without the token on a non-rate-limit 403 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({}, { status: 403, headers: { "x-ratelimit-remaining": "4999" } }))
      .mockResolvedValueOnce(res([ghRepo("a1"), ghRepo("a2")]));
    vi.stubGlobal("fetch", fetchMock);

    const out = await listOrgRepos("acme", 5, "ghp_restricted");
    expect(out.repos.map((r) => r.name)).toEqual(["a1", "a2"]);

    // The retry must carry NO Authorization header — that is the entire point.
    const [, firstInit] = fetchMock.mock.calls[0];
    const [, retryInit] = fetchMock.mock.calls[1];
    expect(JSON.stringify(firstInit)).toContain("Authorization");
    expect(JSON.stringify(retryInit)).not.toContain("Authorization");
  });

  // A genuine secondary-limit 403 must BACK OFF, not hammer GitHub again anonymously. Retry-After is
  // present while x-ratelimit-remaining stays > 0, which is exactly why remaining alone is not the test.
  it("does NOT retry a secondary-rate-limit 403 (Retry-After present)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({}, { status: 403, headers: { "retry-after": "60", "x-ratelimit-remaining": "4999" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOrgRepos("acme", 5, "ghp_x")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 60 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry an exhausted-quota 403 (remaining = 0)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOrgRepos("acme", 5, "ghp_x")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 403 that survives the anonymous retry as a real denial", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(res({}, { status: 403, headers: { "x-ratelimit-remaining": "4999" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOrgRepos("acme", 5, "ghp_x")).rejects.toMatchObject({ code: "AUTH" });
  });

  it("never fires an anonymous retry when there was no token to begin with", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({}, { status: 403, headers: { "x-ratelimit-remaining": "4999" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listOrgRepos("acme", 5)).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
