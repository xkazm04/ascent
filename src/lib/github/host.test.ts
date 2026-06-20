import { describe, it, expect, afterEach, vi } from "vitest";
import { githubApiBase, githubGraphqlUrl, githubRawBase } from "./host";

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
