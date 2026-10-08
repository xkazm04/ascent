// The ambient-token visibility check: one conditional `GET /repos/{owner}/{repo}` decides whether the
// operator PAT may serve an anonymous scan request. Fetch is stubbed; no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardAmbientToken, resetRepoVisibilityMemo, resolveRepoVisibility } from "./visibility";

const PAT = "ghp_operator_pat";
const repo = { owner: "Acme", repo: "Widget" };

function respond(status: number, body?: unknown, etag?: string): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: etag ? { etag } : {},
  });
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const sentHeaders = (i: number) => new Headers(fetchMock.mock.calls[i][1]?.headers);

beforeEach(() => {
  resetRepoVisibilityMemo();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveRepoVisibility", () => {
  it("reads `private` from the repo body, with the caller's token, uncached", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { private: false }, 'W/"a"'));
    expect(await resolveRepoVisibility(repo, { token: PAT })).toBe("public");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/repos\/Acme\/Widget$/);
    expect(sentHeaders(0).get("authorization")).toBe(`Bearer ${PAT}`);
    expect(sentHeaders(0).get("if-none-match")).toBeNull();
    expect(fetchMock.mock.calls[0][1]?.cache).toBe("no-store");

    fetchMock.mockResolvedValueOnce(respond(200, { private: true }, 'W/"b"'));
    expect(await resolveRepoVisibility({ owner: "acme", repo: "secret" }, { token: PAT })).toBe("private");
  });

  it("a 304 reuses the remembered answer, revalidated with the remembered ETag", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { private: false }, 'W/"a"'));
    await resolveRepoVisibility(repo, { token: PAT });
    fetchMock.mockResolvedValueOnce(respond(304));
    // Case-insensitive key: GitHub names are.
    expect(await resolveRepoVisibility({ owner: "acme", repo: "widget" }, { token: PAT })).toBe("public");
    expect(sentHeaders(1).get("if-none-match")).toBe('W/"a"');

    fetchMock.mockResolvedValueOnce(respond(200, { private: true }, 'W/"p"'));
    await resolveRepoVisibility({ owner: "o", repo: "p" }, { token: PAT });
    fetchMock.mockResolvedValueOnce(respond(304));
    expect(await resolveRepoVisibility({ owner: "o", repo: "p" }, { token: PAT })).toBe("private");
  });

  it("a 304 with nothing remembered cannot prove anything", async () => {
    fetchMock.mockResolvedValueOnce(respond(304));
    expect(await resolveRepoVisibility(repo, { token: PAT })).toBe("unknown");
  });

  it("404, rate limit, server error, network error and an odd body are all unknown", async () => {
    for (const res of [respond(404, { message: "Not Found" }), respond(403, { message: "rate limit" }), respond(429), respond(500), respond(200, { name: "x" })]) {
      fetchMock.mockResolvedValueOnce(res);
      expect(await resolveRepoVisibility(repo, { token: PAT })).toBe("unknown");
    }
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await resolveRepoVisibility(repo, { token: PAT })).toBe("unknown");
  });

  it("a failed lookup forgets the remembered answer, so a later 304 cannot resurrect it", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { private: false }, 'W/"a"'));
    await resolveRepoVisibility(repo, { token: PAT });
    fetchMock.mockResolvedValueOnce(respond(404));
    await resolveRepoVisibility(repo, { token: PAT });
    fetchMock.mockResolvedValueOnce(respond(304));
    expect(await resolveRepoVisibility(repo, { token: PAT })).toBe("unknown");
    expect(sentHeaders(2).get("if-none-match")).toBeNull();
  });
});

describe("guardAmbientToken", () => {
  function appConfigured() {
    vi.stubEnv("GITHUB_TOKEN", PAT);
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
  }

  it("keeps the ambient token for a repo proven public", async () => {
    appConfigured();
    fetchMock.mockResolvedValueOnce(respond(200, { private: false }, 'W/"a"'));
    expect(await guardAmbientToken(repo, { noAmbientToken: false })).toEqual({ scopeToken: PAT, noAmbientToken: false });
  });

  it("drops it for a private repo and for anything not proven public (fail closed)", async () => {
    appConfigured();
    for (const res of [respond(200, { private: true }, 'W/"p"'), respond(404), respond(403, { message: "rate limit" })]) {
      fetchMock.mockResolvedValueOnce(res);
      expect(await guardAmbientToken(repo, { noAmbientToken: false })).toEqual({ scopeToken: undefined, noAmbientToken: true });
    }
  });

  it("makes no call when a token was already resolved, the caller is already refused, or there is no repo", async () => {
    appConfigured();
    expect(await guardAmbientToken(repo, { token: "ghs_install", noAmbientToken: false })).toEqual({ scopeToken: "ghs_install", noAmbientToken: false });
    expect(await guardAmbientToken(repo, { noAmbientToken: true })).toEqual({ scopeToken: undefined, noAmbientToken: true });
    expect(await guardAmbientToken(null, { noAmbientToken: false })).toEqual({ scopeToken: PAT, noAmbientToken: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("self-host (App not configured) keeps the ambient token with no call", async () => {
    vi.stubEnv("GITHUB_TOKEN", PAT);
    vi.stubEnv("GITHUB_APP_ID", "");
    expect(await guardAmbientToken(repo, { noAmbientToken: false })).toEqual({ scopeToken: PAT, noAmbientToken: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no ambient token: nothing to protect, no call", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
    expect(await guardAmbientToken(repo, { noAmbientToken: false })).toEqual({ scopeToken: undefined, noAmbientToken: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
