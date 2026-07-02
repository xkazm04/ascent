// Webhook signature verification is the trust boundary for the GitHub App: a forged or unsigned
// payload must never be accepted (it can trigger token minting + scans). Locks in the HMAC-SHA256
// check, including the constant-time / length-guarded comparison and the secret-unset fail-closed.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac, generateKeyPairSync } from "crypto";
import {
  verifyWebhook,
  getInstallation,
  getInstallationToken,
  listInstallationRepos,
  listInstallationReposResult,
  invalidateInstallationToken,
  AppApiError,
} from "./app";

const SECRET = "test-webhook-secret";
const sign = (body: string, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const BODY = JSON.stringify({ action: "created", installation: { id: 42 } });

beforeEach(() => vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhook(BODY, sign(BODY))).toBe(true);
  });

  it("rejects a signature computed over a different body (tamper)", () => {
    expect(verifyWebhook(BODY + " ", sign(BODY))).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhook(BODY, sign(BODY, "not-the-secret"))).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhook(BODY, null)).toBe(false);
  });

  it("rejects a malformed/short signature without throwing", () => {
    expect(verifyWebhook(BODY, "sha256=deadbeef")).toBe(false);
  });

  it("fails closed when the secret is not configured", () => {
    vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "");
    expect(verifyWebhook(BODY, sign(BODY))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getInstallationToken — token mint + cache, the expiry-skew/NaN guard, and the
// listInstallationRepos pagination/fork-filter + 401 self-heal. This is the code
// that authenticates EVERY private-repo access, so the cache freshness math and
// the single-shot self-heal are pinned here against silent regressions
// (skew→0, NaN expiry trusted as fresh, 401 infinite-loop, dropped pagination).

// A real RSA key so the production createAppJwt() RS256 signer actually runs —
// we exercise the real JWT path rather than mocking an internal function. The
// JWT itself is never verified by our fetch mock, so any valid key works.
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const INSTALL_ID = 4242;
const SKEW_MS = 180_000; // TOKEN_EXPIRY_SKEW_MS in app.ts
const NOW = 1_750_000_000_000; // fixed wall-clock for deterministic skew math

/** Mock Response compatible with githubAppFetch(): supports .ok, .status, .json(), .text(). */
function ghRes(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** A token mint (POST /access_tokens) response with expiry `msFromNow` after NOW. */
function tokenRes(token: string, msFromNow: number): Response {
  return ghRes({ token, expires_at: new Date(NOW + msFromNow).toISOString() });
}

/** A token mint response carrying a malformed/unparseable expires_at → Date → NaN. */
function tokenResBadExpiry(token: string): Response {
  return ghRes({ token, expires_at: "not-a-real-date" });
}

function repo(name: string, opts: { fork?: boolean; archived?: boolean; private?: boolean } = {}) {
  return {
    full_name: `acme/${name}`,
    name,
    owner: { login: "acme" },
    private: opts.private ?? true,
    html_url: `https://github.com/acme/${name}`,
    language: "TypeScript",
    stargazers_count: 0,
    pushed_at: "2026-01-01T00:00:00Z",
    fork: !!opts.fork,
    archived: !!opts.archived,
  };
}

const isTokenMint = (call: unknown[]) => String(call[0]).includes("/access_tokens");
const isRepoList = (call: unknown[]) => String(call[0]).includes("/installation/repositories");

describe("getInstallationToken — mint, cache, expiry-skew + NaN guard", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "123456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    invalidateInstallationToken(INSTALL_ID); // module-level cache survives across tests
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    invalidateInstallationToken(INSTALL_ID);
  });

  it("mints a fresh token via POST /access_tokens and returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenRes("tok-fresh", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    const tok = await getInstallationToken(INSTALL_ID);

    expect(tok).toBe("tok-fresh");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/app/installations/${INSTALL_ID}/access_tokens`);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  });

  it("REUSES a cached token comfortably outside the skew window (no re-mint)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenRes("tok-cached", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    const first = await getInstallationToken(INSTALL_ID);
    const second = await getInstallationToken(INSTALL_ID);

    expect(first).toBe("tok-cached");
    expect(second).toBe("tok-cached");
    expect(fetchMock).toHaveBeenCalledTimes(1); // second served from cache, no POST
  });

  it("RE-MINTS a token that expires INSIDE the skew window (not served stale)", async () => {
    // Expires 60s out — inside the 180s skew buffer, so it must be treated as expiring.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenRes("tok-near-expiry", SKEW_MS - 120_000))
      .mockResolvedValueOnce(tokenRes("tok-reminted", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    const first = await getInstallationToken(INSTALL_ID);
    const second = await getInstallationToken(INSTALL_ID);

    expect(first).toBe("tok-near-expiry");
    expect(second).toBe("tok-reminted"); // re-minted because cached entry is within skew
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("RE-MINTS once the clock crosses (expiry - skew), even if expiry is still future", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenRes("tok-1", 600_000)) // expires NOW+10min
      .mockResolvedValueOnce(tokenRes("tok-2", 600_000));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getInstallationToken(INSTALL_ID)).toBe("tok-1");
    // Advance to inside the skew window of tok-1: expiry-skew = NOW+600s-180s = NOW+420s.
    vi.setSystemTime(NOW + 600_000 - SKEW_MS + 1_000);
    expect(await getInstallationToken(INSTALL_ID)).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a NaN/garbage expiry as expired — RE-MINTS, never trusts a stuck token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResBadExpiry("tok-nan")) // expires_at unparseable → NaN
      .mockResolvedValueOnce(tokenRes("tok-good", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    const first = await getInstallationToken(INSTALL_ID);
    expect(first).toBe("tok-nan"); // mint itself still returns the token
    const second = await getInstallationToken(INSTALL_ID);
    expect(second).toBe("tok-good"); // NaN expiry is NOT trusted as fresh → re-mint
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh re-mints even when a fresh cached token exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenRes("tok-a", 3_600_000))
      .mockResolvedValueOnce(tokenRes("tok-b", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getInstallationToken(INSTALL_ID)).toBe("tok-a");
    expect(await getInstallationToken(INSTALL_ID, true)).toBe("tok-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidateInstallationToken drops the cache so the next call re-mints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenRes("tok-x", 3_600_000))
      .mockResolvedValueOnce(tokenRes("tok-y", 3_600_000));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getInstallationToken(INSTALL_ID)).toBe("tok-x");
    invalidateInstallationToken(INSTALL_ID);
    expect(await getInstallationToken(INSTALL_ID)).toBe("tok-y");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getInstallation — null account is surfaced as a typed AppApiError, not a TypeError", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "123456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", TEST_PRIVATE_KEY);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resolves account/type/suspendedAt for a normal installation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ghRes({ id: INSTALL_ID, account: { login: "acme", type: "Organization" }, suspended_at: null })),
    );
    const info = await getInstallation(INSTALL_ID);
    expect(info).toEqual({ id: INSTALL_ID, account: "acme", type: "Organization", suspendedAt: null });
  });

  it("throws AppApiError(404) when GitHub returns a null account (gone account), so revocation callers branch deterministically", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ghRes({ id: INSTALL_ID, account: null, suspended_at: null })));
    await expect(getInstallation(INSTALL_ID)).rejects.toMatchObject({ name: "AppApiError", status: 404 });
    await expect(getInstallation(INSTALL_ID)).rejects.toBeInstanceOf(AppApiError);
  });
});

describe("listInstallationRepos — pagination, fork/archived filter, 401 self-heal", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "123456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    invalidateInstallationToken(INSTALL_ID);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    invalidateInstallationToken(INSTALL_ID);
  });

  it("paginates across pages using total_count and filters out forks + archived", async () => {
    // 150 repos total → 2 pages (100 + 50). Page 1 includes a fork + an archived to drop.
    const page1 = [
      repo("keep-1"),
      repo("fork-1", { fork: true }),
      repo("arch-1", { archived: true }),
      ...Array.from({ length: 97 }, (_, i) => repo(`p1-${i}`)),
    ];
    const page2 = Array.from({ length: 50 }, (_, i) => repo(`p2-${i}`));

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      // Match the page query param exactly (note: "per_page=100" also contains "page=1").
      if (/[?&]page=1\b/.test(url)) return Promise.resolve(ghRes({ total_count: 150, repositories: page1 }));
      if (/[?&]page=2\b/.test(url)) return Promise.resolve(ghRes({ total_count: 150, repositories: page2 }));
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listInstallationRepos(INSTALL_ID);

    // Both pages walked.
    const listCalls = fetchMock.mock.calls.filter((c) => isRepoList(c));
    expect(listCalls).toHaveLength(2);
    // fork + archived dropped: 150 raw → 148 kept.
    expect(out).toHaveLength(148);
    expect(out.some((r) => r.name === "fork-1")).toBe(false);
    expect(out.some((r) => r.name === "arch-1")).toBe(false);
    expect(out.some((r) => r.name === "keep-1")).toBe(true);
    // Mapped shape is the AppRepo projection.
    const keep = out.find((r) => r.name === "keep-1")!;
    expect(keep).toMatchObject({ fullName: "acme/keep-1", owner: "acme", private: true });
  });

  it("stops on a short final page (length < per_page) without over-fetching", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      // total_count claims 999 but the first page is short → must stop, not loop.
      return Promise.resolve(ghRes({ total_count: 999, repositories: [repo("only-1"), repo("only-2")] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listInstallationRepos(INSTALL_ID);

    expect(out.map((r) => r.name)).toEqual(["only-1", "only-2"]);
    expect(fetchMock.mock.calls.filter((c) => isRepoList(c))).toHaveLength(1);
  });

  it("self-heals a 401 ONCE: invalidates + re-mints + retries, then succeeds", async () => {
    let listCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) {
        // First mint returns the stale token, the re-mint returns a fresh one.
        return Promise.resolve(tokenRes(listCalls === 0 ? "tok-stale" : "tok-fresh", 3_600_000));
      }
      listCalls++;
      if (listCalls === 1) return Promise.resolve(ghRes("unauthorized", { status: 401 }));
      return Promise.resolve(ghRes({ total_count: 1, repositories: [repo("after-heal")] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listInstallationRepos(INSTALL_ID);

    expect(out.map((r) => r.name)).toEqual(["after-heal"]);
    // Exactly two list attempts (the 401 + the healed retry) and two mints (initial + forced).
    expect(fetchMock.mock.calls.filter((c) => isRepoList(c))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter((c) => isTokenMint(c))).toHaveLength(2);
  });

  it("does NOT self-heal twice — a second 401 propagates (no infinite loop)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      return Promise.resolve(ghRes("unauthorized", { status: 401 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listInstallationRepos(INSTALL_ID)).rejects.toMatchObject({
      name: "AppApiError",
      status: 401,
    });
    // Two list attempts max — original + one heal retry — never a third.
    expect(fetchMock.mock.calls.filter((c) => isRepoList(c))).toHaveLength(2);
  });

  it("a non-401 error is NOT retried — it propagates immediately", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      return Promise.resolve(ghRes("boom", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listInstallationRepos(INSTALL_ID)).rejects.toBeInstanceOf(AppApiError);
    // Only one list attempt — a 500 must not trigger the 401 self-heal path.
    expect(fetchMock.mock.calls.filter((c) => isRepoList(c))).toHaveLength(1);
  });
});

// github-app-installation-webhooks #1: a page-capped listing is a SILENTLY truncated success.
// listInstallationReposResult must report `truncated` so a destructive reconcile can fail-safe
// instead of treating the partial list as the authoritative live set (and unwatching the overflow).
describe("listInstallationReposResult — truncation signal", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "123456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", TEST_PRIVATE_KEY);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    invalidateInstallationToken(INSTALL_ID);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    invalidateInstallationToken(INSTALL_ID);
  });

  it("flags truncated=true when the page cap (MAX_PAGES) is hit before total_count is exhausted", async () => {
    // Every page returns a FULL page of 100 (never a short page), with total_count far above the
    // MAX_PAGES×PER_PAGE ceiling (50×100=5000) → the walk stops at the cap with raw < total.
    const fullPage = Array.from({ length: 100 }, (_, i) => repo(`r${i}`));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      return Promise.resolve(ghRes({ total_count: 999_999, repositories: fullPage }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listInstallationReposResult(INSTALL_ID);

    expect(result.truncated).toBe(true);
    // Capped at exactly MAX_PAGES (50) full pages.
    expect(fetchMock.mock.calls.filter((c) => isRepoList(c))).toHaveLength(50);
    expect(result.repos).toHaveLength(50 * 100);
  });

  it("flags truncated=false on a complete listing (short final page)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      return Promise.resolve(ghRes({ total_count: 2, repositories: [repo("a"), repo("b")] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listInstallationReposResult(INSTALL_ID);

    expect(result.truncated).toBe(false);
    expect(result.repos.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("listInstallationRepos stays a thin AppRepo[] wrapper (back-compat)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (isTokenMint([url])) return Promise.resolve(tokenRes("tok", 3_600_000));
      return Promise.resolve(ghRes({ total_count: 1, repositories: [repo("solo")] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listInstallationRepos(INSTALL_ID);
    expect(out.map((r) => r.name)).toEqual(["solo"]);
  });
});
