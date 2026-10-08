// The private-repo existence oracle on the live SCAN path (/api/scan/stream). With the App configured,
// an owner with no installation reached GitHub on the operator PAT, so `ref=<existing branch>` on a
// private repo it can read resolved (the stream opened) where a missing repo answered REF_NOT_FOUND
// 404, and the ingest itself rode the PAT up to the private-repo refusal. The real guard, scope
// resolve and lifecycle run here against a GitHub double; scanRepository is the one stub.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
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
  return { ...actual, rateLimitRequestShared: vi.fn(async () => ({ ok: true })) };
});
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: vi.fn(() => false),
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5 })),
  scanCreditRefusal: () => new Response(null, { status: 402 }),
}));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: true })),
  refundScanCredit: vi.fn(async () => 5),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/scan-finalize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scan-finalize")>()),
  consumeScanQuota: async () => ({
    blocked: null, quotaRemaining: 4, quotaResetAt: null, quotaScope: "anon" as const, refund: async () => {},
  }),
}));

import { POST } from "./route";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { GitHubError } from "@/lib/github/source";
import { resetRepoVisibilityMemo } from "@/lib/github/visibility";
import { PAT, githubFake, observe } from "../github-fake.fixture";

const REPOS = {
  "acme/secret": { private: true, head: "a".repeat(40), branches: { dev: "b".repeat(40) } },
  "acme/open": { private: false, head: "a".repeat(40), branches: { dev: "b".repeat(40) } },
};
const scan = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/scan/stream", { method: "POST", body: JSON.stringify(body) }));

let gh = githubFake(REPOS);
beforeEach(() => {
  vi.clearAllMocks();
  resetRepoVisibilityMemo();
  gh = githubFake(REPOS);
  vi.stubGlobal("fetch", gh.fetchImpl);
  vi.stubEnv("GITHUB_TOKEN", PAT);
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
  vi.mocked(resolveScanAuth).mockResolvedValue({ orgSlug: "public" });
  vi.mocked(scanRepository).mockRejectedValue(new GitHubError("NOT_FOUND", "Repository not found or is private.", 404));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/scan/stream — a private repo the PAT can read answers like a missing one", () => {
  it("ref=<existing branch>: the same REF_NOT_FOUND 404, before any stream opens", async () => {
    const existing = await observe(await scan({ url: "acme/secret", ref: "dev" }));
    const missing = await observe(await scan({ url: "acme/no-such-repo", ref: "dev" }));
    expect(existing).toEqual(missing);
    expect(existing.status).toBe(404);
    expect(JSON.parse(existing.body)).toMatchObject({ code: "REF_NOT_FOUND" });
    expect(scanRepository).not.toHaveBeenCalled();
    const secretCalls = gh.calls.filter((c) => c.path.startsWith("/repos/acme/secret"));
    expect(secretCalls.slice(1).every((c) => c.auth === null)).toBe(true);
  });

  it("the ingest of a private repo is handed no ambient credential", async () => {
    await (await scan({ url: "acme/secret" })).text();
    expect(vi.mocked(scanRepository).mock.calls[0][1]).toMatchObject({ noAmbientToken: true });
    expect(gh.calls.filter((c) => c.auth !== null).map((c) => c.path)).toEqual(["/repos/acme/secret"]);
  });

  it("a public repo's ingest keeps the ambient token", async () => {
    await (await scan({ url: "acme/open" })).text();
    expect(vi.mocked(scanRepository).mock.calls[0][1]).toMatchObject({ noAmbientToken: false });
    expect(gh.calls.every((c) => c.auth === `Bearer ${PAT}`)).toBe(true);
  });

  it("self-host (App not configured) is unchanged: no visibility check, the PAT resolves the ref", async () => {
    vi.stubEnv("GITHUB_APP_ID", "");
    const res = await scan({ url: "acme/secret", ref: "dev" });
    await res.text();
    expect(res.status).toBe(200);
    expect(gh.calls.map((c) => c.path)).toEqual(["/repos/acme/secret/commits/dev", "/repos/acme/secret/commits/HEAD"]);
    expect(gh.calls.every((c) => c.auth === `Bearer ${PAT}`)).toBe(true);
    expect(vi.mocked(scanRepository).mock.calls[0][1]).toMatchObject({ noAmbientToken: false });
  });
});
