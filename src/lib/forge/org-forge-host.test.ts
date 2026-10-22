// A self-managed GitLab row is read from ITS OWN host (card github-data-1).
//
// Before: scanRepository parsed every coordinate host-less and built `forge.source()` /
// `forge.enrich()` with no host, so an org that connected `https://git.acme.io` had every snapshot and
// MR/governance/CI read sent to gitlab.com at the same path - a 404 at best, another tenant's public
// project at worst. `resolveOrgForgeHost` is the one door: GitHub never consults it, a GitLab scan
// with no installation reads gitlab.com as before, and a configured host that is not a public https
// address refuses the scan (never silently swapped for gitlab.com, never fetched: SSRF).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import type { RepoSnapshot } from "@/lib/types";

const { mockGetInstallation, prStatsCalls } = vi.hoisted(() => ({
  mockGetInstallation: vi.fn(),
  prStatsCalls: [] as Array<{ host?: unknown }>,
}));

vi.mock("@/lib/db/forge-installations", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db/forge-installations")>()),
  getForgeInstallation: mockGetInstallation,
}));
vi.mock("@/lib/forge/gitlab/merge-requests", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/forge/gitlab/merge-requests")>();
  return {
    ...actual,
    fetchGitlabPrStats: vi.fn(async (_path: string, opts: { host?: unknown }) => {
      prStatsCalls.push(opts);
      return null;
    }),
  };
});
vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  decisionsForRepo: async () => [],
}));
vi.mock("@/lib/memory/repo-memory-mirror", () => ({ mirrorRepoMemory: vi.fn() }));

import { resolveOrgForgeHost } from "./org-forge-host";
import { scanRepository, GitHubError } from "@/lib/scan";
import { ingestRepository } from "@/lib/scan-ingest";
import { gitlabForge } from "@/lib/forge/gitlab/source";

const NOW = "2026-10-22T00:00:00Z";
const ACME_HOST = { apiBase: "https://git.acme.io/api/v4", webBase: "https://git.acme.io" };

function installation(host: string | null) {
  return { id: "i1", forge: "gitlab", externalId: "acme", host, hasCredential: false, capabilities: {}, createdAt: NOW, updatedAt: NOW };
}

function spySource() {
  const calls: FetchOptions[] = [];
  const source: RepoSource = {
    async fetchSnapshot(_repo: ParsedRepo, opts: FetchOptions = {}): Promise<RepoSnapshot> {
      calls.push(opts);
      return {
        meta: { owner: "group", name: "proj", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: "sha1" },
        tree: [{ path: "README.md", type: "blob" }],
        files: [{ path: "README.md", content: "# proj", bytes: 6 }],
        commits: [{ message: "feat: x" }],
        truncated: false,
        coverage: 1,
      };
    },
  };
  return { source, calls };
}

const fetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ message: "404 Project Not Found" }), { status: 404, headers: { "content-type": "application/json" } }),
);
const fetchedUrls = () => fetchSpy.mock.calls.map((c) => String(c[0] instanceof Request ? c[0].url : c[0]));

beforeEach(() => {
  mockGetInstallation.mockReset();
  mockGetInstallation.mockResolvedValue(null);
  prStatsCalls.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveOrgForgeHost", () => {
  it("an installed self-managed GitLab host resolves to its API and web roots", async () => {
    mockGetInstallation.mockResolvedValue(installation("https://git.acme.io"));
    expect(await resolveOrgForgeHost("acme", "gitlab")).toEqual({ host: ACME_HOST });
  });

  it("a private-range host is refused, never returned", async () => {
    mockGetInstallation.mockResolvedValue(installation("https://10.0.0.5"));
    expect(await resolveOrgForgeHost("acme", "gitlab")).toEqual({ refused: "host-not-public" });
  });

  it("no installation, or one on the public host, resolves to no host", async () => {
    expect(await resolveOrgForgeHost("acme", "gitlab")).toEqual({});
    mockGetInstallation.mockResolvedValue(installation(null));
    expect(await resolveOrgForgeHost("acme", "gitlab")).toEqual({});
  });

  it("GitHub never consults the installation table", async () => {
    expect(await resolveOrgForgeHost("acme", "github")).toEqual({});
    expect(mockGetInstallation).not.toHaveBeenCalled();
  });
});

describe("scanRepository reads a gitlab: coordinate from the org's own host", () => {
  it("the first fetch goes to the installed host, not gitlab.com", async () => {
    mockGetInstallation.mockResolvedValue(installation("https://git.acme.io"));
    await scanRepository("gitlab:group/proj", { orgSlug: "acme", mock: true, now: NOW }).catch(() => null);
    expect(fetchedUrls()[0]).toMatch(/^https:\/\/git\.acme\.io\/api\/v4\/projects\//);
    expect(fetchedUrls().some((u) => u.includes("gitlab.com"))).toBe(false);
  });

  it("an unsafe host refuses the scan with a fixed message and makes zero fetches", async () => {
    mockGetInstallation.mockResolvedValue(installation("https://10.0.0.5"));
    const err = await scanRepository("gitlab:group/proj", { orgSlug: "acme", mock: true, now: NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).code).toBe("UPSTREAM");
    expect((err as GitHubError).message).not.toContain("10.0.0.5");
    expect((err as GitHubError).message).not.toContain("gitlab.com");
    expect((err as GitHubError).message).not.toContain(String.fromCharCode(0x2014));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("guard: with no installation row the scan reads gitlab.com exactly as before", async () => {
    await scanRepository("gitlab:group/proj", { orgSlug: "acme", mock: true, now: NOW }).catch(() => null);
    expect(fetchedUrls()[0]).toMatch(/^https:\/\/gitlab\.com\/api\/v4\/projects\//);
  });

  it("guard: a GitHub coordinate never consults the resolver", async () => {
    const { source } = spySource();
    await scanRepository("acme/api", { orgSlug: "acme", mock: true, source, now: NOW });
    expect(mockGetInstallation).not.toHaveBeenCalled();
  });
});

describe("ingestRepository hands the host to the GitLab enrichments", () => {
  it("fetchGitlabPrStats receives the same host as the snapshot", async () => {
    const { source } = spySource();
    await ingestRepository({
      parsed: { owner: "group", repo: "proj" },
      source,
      forge: gitlabForge,
      host: ACME_HOST,
      token: "glpat_x",
      emit: () => {},
    });
    expect(prStatsCalls).toHaveLength(1);
    expect(prStatsCalls[0]!.host).toEqual(ACME_HOST);
  });
});
