// Pins the short-TTL payload cache on /api/app/repos (launch-fleet-map 07-27). Every call here is a
// live GitHub App repo listing + two DB queries, and the launch fleet map polls it once per org every
// 90s PER OPEN TAB — so parallel tabs multiplied straight through to GitHub. The cache must collapse
// duplicates within its TTL, expire well before the 90s poll (data stays fresh), never let one org's
// payload be served for another, and never cache a failure.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    })),
  },
}));

const { listInstallationReposResult, getInstallationIdForOwner } = vi.hoisted(() => ({
  listInstallationReposResult: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
}));

vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true, listInstallationReposResult }));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner,
  getOrgMovers: vi.fn(async () => null),
  getRepoStates: vi.fn(async () => ({})),
  isDbConfigured: () => false,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), sessionHasInstallation: vi.fn(async () => true) }));

import { GET } from "./route";

// Distinct org per test: the cache is module-level and survives between tests, exactly as a warm
// serverless instance keeps it between requests.
let n = 0;
const freshOrg = () => `acme${n++}`;
const get = (org: string) => GET(new Request(`https://ascent.example/api/app/repos?org=${org}`));

beforeEach(() => {
  vi.useFakeTimers();
  listInstallationReposResult.mockReset();
  getInstallationIdForOwner.mockReset();
  // Owner→installation resolution is case-insensitive in the real DB layer, so `Acme` and `acme`
  // resolve to the SAME installation — the cache key must not re-split them by casing.
  getInstallationIdForOwner.mockImplementation(async (owner: string) => `inst-${owner.toLowerCase()}`);
  listInstallationReposResult.mockImplementation(async (id: string) => ({
    repos: [
      { fullName: `${String(id).replace("inst-", "")}/web`, owner: String(id).replace("inst-", ""), private: false },
    ],
    truncated: false,
  }));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/app/repos — short-TTL payload cache", () => {
  it("serves a repeat call (a second tab, a StrictMode double-mount) from cache — one GitHub round-trip", async () => {
    const org = freshOrg();
    const first = await (await get(org)).json();
    const second = await (await get(org)).json();
    expect(listInstallationReposResult).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("expires WELL BEFORE the map's 90s poll, so every poll still sees fresh data", async () => {
    const org = freshOrg();
    await get(org);
    vi.advanceTimersByTime(29_000);
    await get(org);
    expect(listInstallationReposResult).toHaveBeenCalledTimes(1);
    // A third of the 90s poll interval: the next real poll can never be served a cached payload.
    vi.advanceTimersByTime(2_000);
    await get(org);
    expect(listInstallationReposResult).toHaveBeenCalledTimes(2);
  });

  it("keys per org+installation — one tenant's payload is never served for another", async () => {
    const a = freshOrg();
    const b = freshOrg();
    const ra = await (await get(a)).json();
    const rb = await (await get(b)).json();
    expect(listInstallationReposResult).toHaveBeenCalledTimes(2);
    expect((ra as { installationId: string }).installationId).toBe(`inst-${a}`);
    expect((rb as { installationId: string }).installationId).toBe(`inst-${b}`);
  });

  it("normalizes the org key, so `Acme` and `acme` share one entry instead of doubling the calls", async () => {
    const org = freshOrg();
    await get(org);
    await get(org.toUpperCase());
    expect(listInstallationReposResult).toHaveBeenCalledTimes(1);
  });

  it("never caches a FAILURE — the next call retries instead of being stuck on a 502 for the TTL", async () => {
    const org = freshOrg();
    listInstallationReposResult.mockRejectedValueOnce(new Error("GitHub 502"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await get(org);
    expect(bad.status).toBe(502);
    const good = await get(org);
    expect(good.status).toBe(200);
    expect(listInstallationReposResult).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/app/repos — truncation disclosure", () => {
  it("puts truncated=true on the wire when the GitHub listing was page-capped", async () => {
    listInstallationReposResult.mockImplementationOnce(async (id: string) => ({
      repos: [
        { fullName: `${String(id).replace("inst-", "")}/web`, owner: String(id).replace("inst-", ""), private: false },
      ],
      truncated: true,
    }));
    const org = freshOrg();
    const body = (await (await get(org)).json()) as { truncated: boolean };
    expect(body.truncated).toBe(true);
  });

  it("puts truncated=false on a complete listing", async () => {
    const org = freshOrg();
    const body = (await (await get(org)).json()) as { truncated: boolean };
    expect(body.truncated).toBe(false);
  });

  it("caches truncated with the payload so a repeat tab still sees the incomplete listing", async () => {
    listInstallationReposResult.mockImplementation(async (id: string) => ({
      repos: [
        { fullName: `${String(id).replace("inst-", "")}/web`, owner: String(id).replace("inst-", ""), private: false },
      ],
      truncated: true,
    }));
    const org = freshOrg();
    const first = (await (await get(org)).json()) as { truncated: boolean };
    const second = (await (await get(org)).json()) as { truncated: boolean };
    expect(listInstallationReposResult).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.truncated).toBe(true);
  });
});
