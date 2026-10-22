// scanRepository binds its credential to the forge it routed to (src/lib/forge/scan-credential.ts).
//
// Before the bind, `opts.token ?? GITHUB_TOKEN` was applied for every forge: a `gitlab:` coordinate
// handed the org's GitHub installation token (or the operator PAT) to GitLabSource and the GitLab
// enrichments, which send it as `Authorization: Bearer` to gitlab.com. A spy source records the
// FetchOptions, and a stubbed fetch records every header the enrichments would have sent.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanRepository } from "./scan";
import type { FetchOptions, ParsedRepo, RepoSource } from "@/lib/github/source";
import type { RepoSnapshot } from "@/lib/types";

vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  decisionsForRepo: async () => [],
}));
vi.mock("@/lib/memory/repo-memory-mirror", () => ({ mirrorRepoMemory: vi.fn() }));

const NOW = "2026-10-22T00:00:00Z";

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

/** Every Authorization header any enrichment tried to send. */
const sentAuth: string[] = [];
const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const h = new Headers(init?.headers);
  const auth = h.get("authorization") ?? h.get("private-token");
  if (auth) sentAuth.push(auth);
  return new Response(JSON.stringify({ message: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
});

beforeEach(() => {
  sentAuth.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scanRepository binds the token to the routed forge", () => {
  it("a GitHub installation token is NOT handed to a GitLab coordinate's source or enrichments", async () => {
    const { source, calls } = spySource();
    await scanRepository("gitlab:group/proj", { token: "ghs_install", mock: true, source, now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.token).toBeUndefined();
    expect(sentAuth.filter((a) => a.includes("ghs_install"))).toEqual([]);
  });

  it("the ambient GITHUB_TOKEN never reaches a GitLab coordinate, and the report says the sensors were skipped", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_env");
    const { source, calls } = spySource();
    const report = await scanRepository("gitlab:group/proj", { mock: true, source, now: NOW });
    expect(calls[0]!.token).toBeUndefined();
    expect(sentAuth.filter((a) => a.includes("ghp_env"))).toEqual([]);
    // hasToken: false is what reports the token-gated sensors as skipped, not scored.
    expect(report.warnings?.some((w) => w.startsWith("Pull-request signals were skipped"))).toBe(true);
  });

  it("logs the refused bind once, without the token value", async () => {
    const warn = vi.mocked(console.warn);
    const { source } = spySource();
    await scanRepository("gitlab:group/proj", { token: "ghs_install", mock: true, source, now: NOW });
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("forge-bound"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("ghs_install");
  });

  it("a caller-labelled GitLab credential still flows to the GitLab coordinate", async () => {
    const { source, calls } = spySource();
    await scanRepository("gitlab:group/proj", { token: "glpat_x", tokenForge: "gitlab", mock: true, source, now: NOW });
    expect(calls[0]!.token).toBe("glpat_x");
  });

  it("guard: a GitHub coordinate keeps its explicit token unchanged", async () => {
    const { source, calls } = spySource();
    await scanRepository("acme/api", { token: "ghs_install", mock: true, source, now: NOW });
    expect(calls[0]!.token).toBe("ghs_install");
  });

  it("guard: a GitHub coordinate still falls back to the ambient GITHUB_TOKEN", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_env");
    const { source, calls } = spySource();
    await scanRepository("acme/api", { mock: true, source, now: NOW });
    expect(calls[0]!.token).toBe("ghp_env");
  });
});
