import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchWithTimeout, githubApiBase, githubGraphqlUrl, githubRawBase } from "./host";

describe("github host resolution", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the GitHub.com hosts when unset", () => {
    expect(githubApiBase()).toBe("https://api.github.com");
    expect(githubGraphqlUrl()).toBe("https://api.github.com/graphql");
    expect(githubRawBase()).toBe("https://raw.githubusercontent.com");
  });

  it("overrides to a GHES host and strips a trailing slash", () => {
    vi.stubEnv("GITHUB_API_URL", "https://ghe.acme.com/api/v3/");
    vi.stubEnv("GITHUB_GRAPHQL_URL", "https://ghe.acme.com/api/graphql");
    vi.stubEnv("GITHUB_RAW_URL", "https://ghe.acme.com/raw");
    expect(githubApiBase()).toBe("https://ghe.acme.com/api/v3");
    expect(githubGraphqlUrl()).toBe("https://ghe.acme.com/api/graphql");
    expect(githubRawBase()).toBe("https://ghe.acme.com/raw");
  });

  it("treats a blank override as unset (falls back to the default)", () => {
    vi.stubEnv("GITHUB_API_URL", "   ");
    expect(githubApiBase()).toBe("https://api.github.com");
  });
});

// The regression this guards: the timeout used to be a hand-rolled controller + setTimeout cleared in a
// `finally`, which fires the moment fetch resolves — i.e. when the response HEADERS arrive. Every caller
// in this layer then reads the body (res.json() / res.text()) with no timeout at all, so a connection
// stalling mid-body hung until the route's maxDuration. The signal must stay armed AFTER fetch resolves.
describe("fetchWithTimeout — the budget covers the body, not just the headers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves the fetch signal armed after the response resolves", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Response("{}"); // headers land immediately; the body would stream after
    }));

    await fetchWithTimeout("https://api.github.test/x", {}, 20);
    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false); // not yet — the body is still readable

    await new Promise((r) => setTimeout(r, 45));
    // Previously this was false forever: the timer was cleared when fetch resolved, so a stalled body
    // read had nothing to abort it.
    expect(seen!.aborted).toBe(true);
  });

  it("still aborts on the caller's signal (client disconnect), combined with the timeout", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Response("{}");
    }));
    const caller = new AbortController();

    await fetchWithTimeout("https://api.github.test/x", {}, 60_000, caller.signal);
    expect(seen!.aborted).toBe(false);
    caller.abort();
    expect(seen!.aborted).toBe(true);
  });
});
