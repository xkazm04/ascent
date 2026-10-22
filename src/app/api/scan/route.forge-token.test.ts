// A GitLab token in the body of POST /api/scan reaches the GitLab client (fix-forward of github-data-0).
//
// github-data-0 bound every scan token to the forge that issued it, with an unlabelled token read as a
// GitHub one. The scan lifecycle could not carry the label, so a GitLab PAT a caller put in the body
// for a `gitlab:` coordinate was dropped and the scan ran token-less. The route now labels a BODY
// token for a GitLab coordinate as `gitlab` and the lifecycle threads `tokenForge` to scanRepository.
// The binding itself is untouched: the ambient GITHUB_TOKEN still never reaches a GitLab host.
//
// The REAL scanRepository runs (mock LLM, stubbed fetch), so the assertion is on the header the GitLab
// transport actually sent, not on an option somebody passed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/scan")>()),
  resolveScanAuth: vi.fn(async () => ({ orgSlug: "public" })),
}));
vi.mock("@/lib/scan-cache", () => ({ lookupCachedScan: vi.fn(async () => null), isPersistedScanFresh: () => false }));
vi.mock("@/lib/db", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db")>()),
  isDbConfigured: () => false,
  decisionsForRepo: async () => [],
  getScanReportByCommit: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
  getOrgId: vi.fn(async () => null),
}));
vi.mock("@/lib/public-scan-quota", () => ({
  consumePublicScanQuota: vi.fn(async () => ({ enforced: false, allowed: true, remaining: 3, chargedAt: null, resetAt: null, signedIn: false })),
  refundPublicScanQuota: vi.fn(async () => {}),
  monthlyQuotaExceeded: () => new Response("{}", { status: 429 }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitRequest: vi.fn(() => ({ ok: true })),
  rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/memory/repo-memory-mirror", () => ({ mirrorRepoMemory: vi.fn() }));

import { POST } from "./route";

/** Every (url, Authorization) pair the scan sent. */
const sent: Array<{ url: string; auth: string | null }> = [];
const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  sent.push({ url, auth: new Headers(init?.headers).get("authorization") });
  return new Response(JSON.stringify({ message: "404 Project Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
});
const toGitlab = () => sent.filter((s) => s.url.startsWith("https://gitlab.com/"));

function post(body: unknown) {
  return POST(new Request("http://localhost/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  sent.length = 0;
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

describe("POST /api/scan forwards a body GitLab token to the GitLab client", () => {
  it("a gitlab: scan with a body token reaches gitlab.com with that token", async () => {
    await post({ url: "gitlab:group/proj", token: "glpat_body", mock: true });
    expect(toGitlab().length).toBeGreaterThan(0);
    expect(toGitlab()[0]!.auth).toBe("Bearer glpat_body");
  });

  it("guard: the ambient GitHub token still never reaches GitLab", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_env");
    await post({ url: "gitlab:group/proj", mock: true });
    expect(toGitlab().length).toBeGreaterThan(0);
    expect(sent.some((s) => s.auth?.includes("ghp_env") && !s.url.includes("api.github.com"))).toBe(false);
  });

  it("guard: a body token on a GitHub coordinate is never labelled gitlab, so it never leaves GitHub", async () => {
    await post({ url: "acme/api", token: "ghs_body", mock: true });
    expect(sent.filter((s) => s.auth?.includes("ghs_body")).every((s) => !s.url.includes("gitlab"))).toBe(true);
  });
});
