// The private-repo existence oracle on the anonymous PEEK path. With the GitHub App configured, an
// owner with no installation reaches GitHub on the operator PAT, which can read private repos. Before
// the ambient-token guard, a peek of such a private repo returned its head sha/etag and a `?ref=`
// resolve answered 204 where a missing repo answered 204 bare / 404. These tests run the REAL scope
// resolve, head lookup, lifecycle and guard against a GitHub double (./github-fake.fixture), so what
// is asserted is what an anonymous caller can observe.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(), resolveScanAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => false),
  getHeadHint: vi.fn(async () => null),
  getScanReportByCommit: vi.fn(async () => null),
  persistScanReport: vi.fn(),
  getOrgId: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: vi.fn(() => ({ ok: true })),
    rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
    tooManyRequests: actual.tooManyRequests,
    SCAN_RATE_LIMIT: {},
    PEEK_RATE_LIMIT: {},
  };
});
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));

import { GET } from "./route";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { resetRepoVisibilityMemo } from "@/lib/github/visibility";
import { PAT, githubFake, observe } from "./github-fake.fixture";

const HEAD = "a".repeat(40);
const DEV = "b".repeat(40);
const REPOS = {
  "acme/secret": { private: true, head: HEAD, branches: { dev: DEV } },
  "acme/open": { private: false, head: HEAD, branches: { dev: DEV } },
};
const peek = (repo: string, extra = "") => GET(new Request(`http://x/api/scan?url=acme%2F${repo}&peek=1${extra}`));

let gh = githubFake(REPOS);
beforeEach(() => {
  vi.clearAllMocks();
  resetRepoVisibilityMemo();
  gh = githubFake(REPOS);
  vi.stubGlobal("fetch", gh.fetchImpl);
  vi.stubEnv("GITHUB_TOKEN", PAT);
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
  // Not an installed owner: the anonymous funnel, on the ambient token.
  vi.mocked(resolveScanAuth).mockResolvedValue({ orgSlug: "public" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/scan?peek=1 — a private repo the PAT can read answers like a missing one", () => {
  for (const [mode, extra] of [
    ["plain peek", ""],
    ["peek&recent=1", "&recent=1"],
    ["peek&latest=1", "&latest=1"],
    ["peek&ref=<existing branch>", "&ref=dev"],
  ] as const) {
    it(mode, async () => {
      const existing = await observe(await peek("secret", extra));
      const missing = await observe(await peek("no-such-repo", extra));
      expect(existing).toEqual(missing);
      expect(existing.headers.map(([k]) => k)).not.toContain("x-ascent-head-sha");
      expect(existing.headers.map(([k]) => k)).not.toContain("x-ascent-head-etag");
      // After the one visibility check, nothing about the private repo reached GitHub on the PAT.
      const secretCalls = gh.calls.filter((c) => c.path.startsWith("/repos/acme/secret"));
      expect(secretCalls[0]).toMatchObject({ path: "/repos/acme/secret", auth: `Bearer ${PAT}` });
      expect(secretCalls.slice(1).every((c) => c.auth === null)).toBe(true);
      expect(scanRepository).not.toHaveBeenCalled();
    });
  }
});

describe("GET /api/scan?peek=1 — a public repo keeps the token and the head headers", () => {
  it("cold: one visibility call, then the head lookup, all with Authorization", async () => {
    const res = await peek("open");
    expect(res.status).toBe(204);
    expect(res.headers.get("x-ascent-head-sha")).toBe(HEAD);
    expect(res.headers.get("x-ascent-head-etag")).toBe(`"head-${HEAD}"`);
    expect(gh.calls.map((c) => c.path)).toEqual(["/repos/acme/open", "/repos/acme/open/commits/HEAD"]);
    expect(gh.calls.every((c) => c.auth === `Bearer ${PAT}`)).toBe(true);
  });

  it("warm: the visibility check revalidates as a 304 and reuses the remembered answer", async () => {
    await peek("open");
    const res = await peek("open");
    expect(res.headers.get("x-ascent-head-sha")).toBe(HEAD);
    const visibility = gh.calls.filter((c) => c.path === "/repos/acme/open");
    expect(visibility.map((c) => c.status)).toEqual([200, 304]);
    expect(visibility[1].ifNoneMatch).toBe('W/"meta-acme-open-false"');
    // The head lookup after the 304 still rode the PAT: the remembered answer was "public".
    expect(gh.calls.at(-1)).toMatchObject({ path: "/repos/acme/open/commits/HEAD", auth: `Bearer ${PAT}` });
  });
});

describe("GET /api/scan?peek=1 — a failed visibility check fails closed", () => {
  it("rate-limited check: no credential afterwards and no head headers for a private repo", async () => {
    gh = githubFake(REPOS, { failMetadata: 403 });
    vi.stubGlobal("fetch", gh.fetchImpl);
    const res = await peek("secret");
    expect(res.status).toBe(204);
    expect(res.headers.get("x-ascent-head-sha")).toBeNull();
    expect(res.headers.get("x-ascent-head-etag")).toBeNull();
    expect(gh.calls.slice(1).length).toBeGreaterThan(0);
    expect(gh.calls.slice(1).every((c) => c.auth === null)).toBe(true);
  });

  it("a public repo whose check failed is read with no credential", async () => {
    gh = githubFake(REPOS, { failMetadata: 500 });
    vi.stubGlobal("fetch", gh.fetchImpl);
    await peek("open");
    expect(gh.calls.find((c) => c.path === "/repos/acme/open/commits/HEAD")?.auth).toBeNull();
  });
});

describe("GET /api/scan?peek=1 — unchanged paths", () => {
  it("an installed owner with an authorized caller keeps its installation token and makes no visibility check", async () => {
    vi.mocked(resolveScanAuth).mockResolvedValue({ token: "ghs_install", orgSlug: "acme" });
    const res = await peek("secret", "&ref=dev");
    expect(res.status).toBe(204);
    expect(gh.calls.map((c) => c.path)).toEqual(["/repos/acme/secret/commits/dev"]);
    expect(gh.calls[0].auth).toBe("Bearer ghs_install");
  });

  it("self-host (App not configured) keeps the ambient token everywhere, with no visibility check", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    const res = await peek("secret");
    expect(res.headers.get("x-ascent-head-sha")).toBe(HEAD);
    expect(gh.calls.map((c) => c.path)).toEqual(["/repos/acme/secret/commits/HEAD"]);
    expect(gh.calls[0].auth).toBe(`Bearer ${PAT}`);
  });
});
