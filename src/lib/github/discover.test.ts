import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchUserOrgs,
  fetchUserRepos,
  rankDiscoveredOrgs,
  selectSeedTarget,
  selectSuggestedOrgLogins,
  type UserRepo,
} from "@/lib/github/discover";

// These cover the pure ranking/selection over the fetched GitHub data — the org auto-discovery
// brain — without any network. The fetchers themselves are thin and exercised by the live flow.

function repo(
  owner: string,
  name: string,
  opts: { type?: string; private?: boolean; pushedAt?: string } = {},
): UserRepo {
  return {
    owner,
    ownerType: opts.type ?? "Organization",
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
    isPrivate: opts.private ?? false,
    pushedAt: opts.pushedAt ?? null,
  };
}

describe("rankDiscoveredOrgs", () => {
  const repos: UserRepo[] = [
    repo("Acme", "web", { pushedAt: "2026-05-10T00:00:00Z" }),
    repo("Acme", "api", { pushedAt: "2026-05-12T00:00:00Z", private: true }),
    repo("Acme", "infra", { pushedAt: "2026-05-08T00:00:00Z" }),
    repo("delta", "tool", { pushedAt: "2026-05-11T00:00:00Z" }),
    repo("delta", "lib", { pushedAt: "2026-05-01T00:00:00Z" }),
    repo("beta", "site", { pushedAt: "2026-04-01T00:00:00Z" }),
    repo("octocat", "dotfiles", { type: "User", pushedAt: "2026-06-01T00:00:00Z" }), // personal — excluded
  ];

  const ranked = rankDiscoveredOrgs({
    orgLogins: ["Acme", "beta", "gamma"], // gamma is a membership with no recent repos
    repos,
    installedSlugs: ["beta"],
    viewerLogin: "octocat",
  });

  it("orders orgs by how actively the user works in them (repo count, then recency)", () => {
    expect(ranked.map((o) => o.slug)).toEqual(["acme", "delta", "beta", "gamma"]);
    expect(ranked.map((o) => o.repoCount)).toEqual([3, 2, 1, 0]);
  });

  it("discovers orgs from repo ownership even when /user/orgs didn't list them", () => {
    expect(ranked.find((o) => o.slug === "delta")).toBeTruthy(); // never in orgLogins
  });

  it("excludes the viewer's own (personal) account", () => {
    expect(ranked.some((o) => o.slug === "octocat")).toBe(false);
  });

  it("preserves canonical login casing and marks installed orgs", () => {
    const acme = ranked.find((o) => o.slug === "acme")!;
    expect(acme.login).toBe("Acme");
    expect(acme.installed).toBe(false);
    expect(ranked.find((o) => o.slug === "beta")!.installed).toBe(true);
  });

  it("derives each org's top repos most-recently-pushed first", () => {
    const acme = ranked.find((o) => o.slug === "acme")!;
    expect(acme.topRepos.map((r) => r.name)).toEqual(["api", "web", "infra"]);
    expect(acme.lastPushedAt).toBe("2026-05-12T00:00:00Z");
  });

  it("keeps membership-only orgs (no repos) at the tail", () => {
    const gamma = ranked.find((o) => o.slug === "gamma")!;
    expect(gamma.repoCount).toBe(0);
    expect(gamma.lastPushedAt).toBeNull();
  });
});

describe("selectSuggestedOrgLogins", () => {
  const ranked = rankDiscoveredOrgs({
    orgLogins: ["Acme", "beta", "gamma"],
    repos: [
      repo("Acme", "web", { pushedAt: "2026-05-10T00:00:00Z" }),
      repo("Acme", "api", { pushedAt: "2026-05-09T00:00:00Z" }),
      repo("delta", "tool", { pushedAt: "2026-05-11T00:00:00Z" }),
    ],
    installedSlugs: ["beta"],
    viewerLogin: "octocat",
  });

  it("omits already-installed orgs and keeps the active-first order + casing", () => {
    expect(selectSuggestedOrgLogins(ranked)).toEqual(["Acme", "delta", "gamma"]);
  });

  it("caps the list to the requested max", () => {
    expect(selectSuggestedOrgLogins(ranked, 2)).toEqual(["Acme", "delta"]);
  });
});

describe("selectSeedTarget", () => {
  it("seeds the most-active org's public repos when it isn't installed", () => {
    const ranked = rankDiscoveredOrgs({
      orgLogins: ["Acme"],
      repos: [
        repo("Acme", "web", { pushedAt: "2026-05-10T00:00:00Z" }),
        repo("Acme", "api", { pushedAt: "2026-05-12T00:00:00Z", private: true }),
        repo("Acme", "infra", { pushedAt: "2026-05-08T00:00:00Z" }),
      ],
      installedSlugs: [],
      viewerLogin: "octocat",
    });
    const seed = selectSeedTarget(ranked);
    expect(seed?.slug).toBe("acme");
    // private "api" dropped (no installation token could ever scan it), order by recency preserved.
    expect(seed?.repos.map((r) => r.name)).toEqual(["web", "infra"]);
  });

  it("includes private repos when the org IS installed (token can read them)", () => {
    const ranked = rankDiscoveredOrgs({
      orgLogins: ["Acme"],
      repos: [repo("Acme", "api", { pushedAt: "2026-05-12T00:00:00Z", private: true })],
      installedSlugs: ["acme"],
      viewerLogin: "octocat",
    });
    expect(selectSeedTarget(ranked)?.repos.map((r) => r.name)).toEqual(["api"]);
  });

  it("caps the seeded repos", () => {
    const ranked = rankDiscoveredOrgs({
      orgLogins: ["Acme"],
      repos: Array.from({ length: 10 }, (_, i) => repo("Acme", `r${i}`, { pushedAt: `2026-05-${10 + i}T00:00:00Z` })),
      installedSlugs: [],
      viewerLogin: "octocat",
    });
    expect(selectSeedTarget(ranked, 3)?.repos).toHaveLength(3);
  });

  it("returns null when no discovered org has a seedable repo", () => {
    // Membership-only org (no repos) + a non-installed org whose only repo is private.
    const ranked = rankDiscoveredOrgs({
      orgLogins: ["gamma"],
      repos: [repo("delta", "secret", { private: true, pushedAt: "2026-05-01T00:00:00Z" })],
      installedSlugs: [],
      viewerLogin: "octocat",
    });
    expect(selectSeedTarget(ranked)).toBeNull();
  });
});

// github-repo-data-access #1: the fetchers must honor the GHES `GITHUB_API_URL` host override, not
// hardcode api.github.com — otherwise org auto-discovery 401s/firewalls on enterprise deployments.
describe("fetchUserOrgs / fetchUserRepos — GHES host override", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("hits the GHES base when GITHUB_API_URL is set", async () => {
    vi.stubEnv("GITHUB_API_URL", "https://ghe.acme.com/api/v3");
    const fetchMock = stubFetch([{ login: "Acme" }]);
    await fetchUserOrgs("tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://ghe.acme.com/api/v3/user/orgs?per_page=100");
  });

  it("trims a trailing slash on the GHES base for repos", async () => {
    vi.stubEnv("GITHUB_API_URL", "https://ghe.acme.com/api/v3/");
    const fetchMock = stubFetch([]);
    await fetchUserRepos("tok");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/ghe\.acme\.com\/api\/v3\/user\/repos\?/);
  });

  it("defaults to api.github.com when GITHUB_API_URL is unset", async () => {
    vi.stubEnv("GITHUB_API_URL", "");
    const fetchMock = stubFetch([{ login: "Acme" }]);
    await fetchUserOrgs("tok");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/user/orgs?per_page=100");
  });
});
