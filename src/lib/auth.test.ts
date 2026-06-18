import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// auth.ts imports `cookies` AND `headers` from next/headers at module load. The original pure-helper
// tests never touch the cookie store; the new session-state / authorization tests below drive both,
// so the mocks are shared, hoisted vi.fn()s reset per-test (defaults restored in beforeEach).
const { mockCookies, mockHeaders, mockIsDbConfigured, mockGetSessionVersion } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockHeaders: vi.fn(),
  mockIsDbConfigured: vi.fn(),
  mockGetSessionVersion: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies, headers: mockHeaders }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: vi.fn() }));
vi.mock("@/lib/db/sessions", () => ({
  getSessionVersion: mockGetSessionVersion,
  bumpSessionVersion: vi.fn(),
}));

import {
  buildSession,
  encodeSession,
  decodeSession,
  publicOriginForRequest,
  safeNext,
  getSessionState,
  readableOrgForOwner,
  isSameOrigin,
  type Session,
  type UserInstallation,
} from "./auth";

// hmac() reads AUTH_SECRET lazily at call time, so setting it before the tests run is enough.
// The OAuth client id/secret are read by isAuthConfigured() (gate at the top of getSessionState),
// so they must be present for the session-state tests to get past it.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-auth-spec";
  process.env.GITHUB_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-client-secret";
});

/** A cookie store double. `get(name)` returns the seeded session cookie; `set` is recorded so a
 *  test can assert a re-mint happened (or make it throw to model a read-only Server Component store). */
function fakeCookieStore(rawSessionValue?: string, setImpl?: (...a: unknown[]) => void) {
  const set = vi.fn(setImpl);
  return {
    store: {
      get: vi.fn((name: string) =>
        name === "ascent_session" && rawSessionValue !== undefined ? { value: rawSessionValue } : undefined,
      ),
      set,
    },
    set,
  };
}

// secureCookieForRequest() calls headers().get("x-forwarded-proto"); a plain store is enough.
function fakeHeaderStore(values: Record<string, string> = {}) {
  return { get: vi.fn((name: string) => values[name.toLowerCase()] ?? null) };
}

beforeEach(() => {
  mockCookies.mockReset();
  mockHeaders.mockReset();
  mockIsDbConfigured.mockReset();
  mockGetSessionVersion.mockReset();
  // Sensible defaults: no cookie, stateless (no DB), benign headers. Each test overrides as needed.
  mockCookies.mockResolvedValue(fakeCookieStore().store);
  mockHeaders.mockResolvedValue(fakeHeaderStore());
  mockIsDbConfigured.mockReturnValue(false);
  mockGetSessionVersion.mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Conservative ceiling browsers enforce per cookie (name+value). The whole point of the fix is to
// stay under this so the Set-Cookie isn't silently dropped.
const BROWSER_COOKIE_LIMIT = 4096;

function makeInstallations(n: number, loginLen = 39): UserInstallation[] {
  // Max-length-ish org logins + large ids to model the worst-case (biggest) payload.
  return Array.from({ length: n }, (_, i) => ({
    id: 100_000_000 + i,
    login: `org-${i}`.padEnd(loginLen, "x").slice(0, loginLen),
  }));
}

describe("encodeSession", () => {
  it("round-trips a normal session through decodeSession", () => {
    const session = buildSession({ login: "octocat", name: "Octo Cat" }, makeInstallations(3));
    const decoded = decodeSession(encodeSession(session));
    expect(decoded).toEqual(session);
  });

  it("produces an ASCII value whose length stays under the browser cookie limit", () => {
    const session = buildSession({ login: "octocat" }, makeInstallations(10));
    const value = encodeSession(session);
    expect(value.length).toBe(Buffer.byteLength(value)); // pure ASCII (base64url + ".")
    expect(value.length).toBeLessThan(BROWSER_COOKIE_LIMIT);
  });

  it("fails loudly instead of emitting an oversized cookie the browser would drop", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Construct an over-budget session directly, bypassing buildSession's cap, to exercise the guard.
    const oversized: Session = {
      login: "power-user",
      installations: makeInstallations(500),
      exp: Date.now() + 86_400_000,
    };
    expect(() => encodeSession(oversized)).toThrow(/too large|size limit/i);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0][0]).toContain("power-user");
  });
});

describe("session version + refresh horizon", () => {
  it("decodeSession honors the legacy long-lived `exp` when there is no `rexp`", () => {
    // Cookies minted before this feature carry only `exp` (the old 7-day expiry) and no
    // `rexp`/`sv`; they must keep working until that `exp` passes.
    const valid = encodeSession({ login: "octocat", installations: [], exp: Date.now() + 60_000 } as Session);
    expect(decodeSession(valid)?.login).toBe("octocat");
    const expired = encodeSession({ login: "octocat", installations: [], exp: Date.now() - 1_000 } as Session);
    expect(decodeSession(expired)).toBeNull();
  });

  it("decodeSession accepts a spent access token still within the refresh horizon", () => {
    // The short access `exp` only gates silent refresh — past it, the session is still valid
    // (and decodable) up to `rexp`, so getSessionState can re-mint it.
    const token = encodeSession({
      login: "octocat",
      installations: [],
      exp: Date.now() - 1_000,
      rexp: Date.now() + 60_000,
      sv: 2,
    });
    const decoded = decodeSession(token);
    expect(decoded?.login).toBe("octocat");
    expect(decoded?.sv).toBe(2);
  });

  it("decodeSession rejects a token past its refresh horizon", () => {
    const token = encodeSession({
      login: "octocat",
      installations: [],
      exp: Date.now() - 2_000,
      rexp: Date.now() - 1_000,
      sv: 0,
    });
    expect(decodeSession(token)).toBeNull();
  });
});

describe("buildSession", () => {
  it("stamps the session version and a short access window inside the refresh horizon", () => {
    const before = Date.now();
    const session = buildSession({ login: "octocat" }, makeInstallations(2), 5);
    expect(session.sv).toBe(5);
    expect(session.exp).toBeGreaterThan(before);
    // The access window (`exp`) is shorter than the inactivity horizon (`rexp`).
    expect(session.rexp ?? 0).toBeGreaterThan(session.exp);
  });

  it("defaults the session version to 0 when none is supplied", () => {
    expect(buildSession({ login: "octocat" }, makeInstallations(1)).sv).toBe(0);
  });

  it("keeps every installation when the payload fits", () => {
    const installs = makeInstallations(5);
    const session = buildSession({ login: "octocat" }, installs);
    expect(session.installations).toEqual(installs);
  });

  it("caps installations so the encoded cookie stays under the browser limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const installs = makeInstallations(500);
    const session = buildSession({ login: "power-user", name: "Power User" }, installs);

    // Trimmed below the input count, but still a usable subset...
    expect(session.installations.length).toBeGreaterThan(0);
    expect(session.installations.length).toBeLessThan(installs.length);
    // ...kept from the front (deterministic tail-drop)...
    expect(session.installations).toEqual(installs.slice(0, session.installations.length));
    // ...and the result both encodes without throwing and stays under the cookie limit.
    const value = encodeSession(session);
    expect(value.length).toBeLessThan(BROWSER_COOKIE_LIMIT);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("safeNext", () => {
  // GitHub org/repo names use hyphens constantly and encodeURIComponent does not encode `-`, so
  // hyphenated paths MUST round-trip — the control-char class was once misread as the Annex-B
  // `[ -\s]` union (which matches a literal hyphen) and would have bounced these to the fallback.
  it("accepts root-relative paths containing hyphens", () => {
    expect(safeNext("/org/acme-corp")).toBe("/org/acme-corp");
    expect(safeNext("/report/next-forge/create-react-app")).toBe("/report/next-forge/create-react-app");
    expect(safeNext("/trends?repo=my-org/my-repo")).toBe("/trends?repo=my-org/my-repo");
  });

  it("preserves query and fragment on a safe path", () => {
    expect(safeNext("/trends?repo=a/b#dimensions")).toBe("/trends?repo=a/b#dimensions");
  });

  it("falls back for absolute, protocol-relative, and backslash targets", () => {
    expect(safeNext("https://evil.example")).toBe("/connect");
    expect(safeNext("//evil.example/phish")).toBe("/connect");
    expect(safeNext("/\\evil.example")).toBe("/connect");
    expect(safeNext("/a\\b")).toBe("/connect");
  });

  it("falls back for control chars and whitespace that could smuggle a host", () => {
    expect(safeNext("/a b")).toBe("/connect");
    expect(safeNext("/a\tb")).toBe("/connect");
    expect(safeNext("/a\nb")).toBe("/connect");
    expect(safeNext(`/a${String.fromCharCode(0)}b`)).toBe("/connect");
    expect(safeNext(`/a${String.fromCharCode(0x1f)}b`)).toBe("/connect");
    expect(safeNext(`/a${String.fromCharCode(0x7f)}b`)).toBe("/connect");
  });

  it("falls back for empty / non-path values, honoring a custom fallback", () => {
    expect(safeNext(null)).toBe("/connect");
    expect(safeNext(undefined)).toBe("/connect");
    expect(safeNext("connect")).toBe("/connect");
    expect(safeNext("javascript:alert(1)", "/home")).toBe("/home");
  });
});

describe("publicOriginForRequest", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("derives the external origin from x-forwarded-proto/host behind a TLS-terminating proxy", () => {
    const r = req("http://10.0.0.5:3000/api/auth/login", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.example.com",
    });
    expect(publicOriginForRequest(r)).toBe("https://app.example.com");
  });

  it("keeps the request host when only the proto is forwarded (proxy preserving Host)", () => {
    const r = req("http://app.example.com/api/auth/callback", { "x-forwarded-proto": "https" });
    expect(publicOriginForRequest(r)).toBe("https://app.example.com");
  });

  it("uses the first value of a comma-separated forwarded chain", () => {
    const r = req("http://internal:3000/x", {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "edge.example.com, internal:3000",
    });
    expect(publicOriginForRequest(r)).toBe("https://edge.example.com");
  });

  it("falls back to the request-derived origin with no forwarded headers (direct / localhost)", () => {
    expect(publicOriginForRequest(req("http://localhost:3000/api/auth/login"))).toBe("http://localhost:3000");
    expect(publicOriginForRequest(req("https://ascent.example/api/auth/login"))).toBe("https://ascent.example");
  });

  it("ignores forwarded values outside the expected grammar instead of interpolating them", () => {
    const r = req("https://app.example.com/x", {
      "x-forwarded-proto": "gopher",
      "x-forwarded-host": "evil.example/phish@host",
    });
    expect(publicOriginForRequest(r)).toBe("https://app.example.com");
  });
});

describe("buildSession — discovered orgs", () => {
  it("embeds suggested orgs + the seeded org and round-trips them", () => {
    const session = buildSession({ login: "octocat" }, makeInstallations(2), 3, {
      suggestedOrgs: ["acme", "beta"],
      seededOrg: "acme",
    });
    expect(session.suggestedOrgs).toEqual(["acme", "beta"]);
    expect(session.seededOrg).toBe("acme");
    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it("omits the discovery fields entirely when nothing was discovered (legacy shape)", () => {
    const session = buildSession({ login: "octocat" }, makeInstallations(2));
    expect(session.suggestedOrgs).toBeUndefined();
    expect(session.seededOrg).toBeUndefined();
  });

  it("sheds discovered orgs before trimming access-granting installations", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Installations alone overflow the budget, so the lower-priority discovery fields can't survive.
    const session = buildSession({ login: "power-user" }, makeInstallations(500), 0, {
      suggestedOrgs: ["a", "b", "c"],
      seededOrg: "a",
    });
    expect(session.suggestedOrgs).toBeUndefined();
    expect(session.seededOrg).toBeUndefined();
    expect(session.installations.length).toBeGreaterThan(0);
    expect(encodeSession(session).length).toBeLessThan(BROWSER_COOKIE_LIMIT);
  });
});

// ── Helpers for the authorization / session-state suites ────────────────────────────────────────

/** Seed a valid, currently-decodable session cookie into the mocked cookie store, and return the
 *  store double so a test can assert on its `set` spy (the re-mint). `exp` defaults to the future so
 *  no refresh fires unless a test deliberately spends it. */
function seedSession(session: Session, opts: { setImpl?: (...a: unknown[]) => void } = {}) {
  const { store, set } = fakeCookieStore(encodeSession(session), opts.setImpl);
  mockCookies.mockResolvedValue(store);
  return { store, set };
}

/** A full, currently-valid session whose short access window is far in the future (no refresh due). */
function activeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    login: "octocat",
    installations: [{ id: 1, login: "Acme" }],
    exp: now + 60 * 60_000,
    rexp: now + 7 * 86_400_000,
    sv: 3,
    ...overrides,
  };
}

describe("readableOrgForOwner — cross-tenant read gate", () => {
  it("returns the lowercased owner org when the viewer HAS a matching installation", async () => {
    // Session installation login is "Acme" (mixed case); the owner param is "acme" (lower). The
    // case-insensitive match must hold and the canonical lowercased slug be returned.
    seedSession(activeSession({ installations: [{ id: 1, login: "Acme" }] }));
    await expect(readableOrgForOwner("acme")).resolves.toBe("acme");
  });

  it("matches case-insensitively when BOTH sides differ in casing (Acme vs acme)", async () => {
    seedSession(activeSession({ installations: [{ id: 7, login: "acme" }] }));
    await expect(readableOrgForOwner("ACME")).resolves.toBe("acme");
  });

  it("DENIES (falls back to public) a viewer who is NOT a member of the target org", async () => {
    // The session is a member of "other-org" only — reading "private-tenant" must NOT leak it.
    seedSession(activeSession({ installations: [{ id: 2, login: "other-org" }] }));
    const org = await readableOrgForOwner("private-tenant");
    expect(org).toBe("public");
    expect(org).not.toBe("private-tenant"); // the load-bearing invariant: never the private slug
  });

  it("returns public for an absent session (no cookie)", async () => {
    mockCookies.mockResolvedValue(fakeCookieStore(undefined).store); // no session cookie
    await expect(readableOrgForOwner("acme")).resolves.toBe("public");
  });

  it("returns public when a member-less session reads its own-cased owner", async () => {
    // Even an exact-case owner string is denied when the session carries no matching installation.
    seedSession(activeSession({ installations: [] }));
    await expect(readableOrgForOwner("Acme")).resolves.toBe("public");
  });
});

describe("isSameOrigin — CSRF guard", () => {
  const reqWith = (headers: Record<string, string>) =>
    new Request("https://app.example.com/api/auth/logout", { method: "POST", headers });

  it("ACCEPTS a request whose Origin host matches the Host header", () => {
    expect(
      isSameOrigin(reqWith({ host: "app.example.com", origin: "https://app.example.com" })),
    ).toBe(true);
  });

  it("REJECTS a cross-site Origin (the drive-by CSRF path)", () => {
    expect(isSameOrigin(reqWith({ host: "app.example.com", origin: "https://evil.com" }))).toBe(false);
  });

  it("REJECTS an Origin that matches host but on a different port", () => {
    // new URL("https://app.example.com:8443").host is "app.example.com:8443" ≠ "app.example.com".
    expect(
      isSameOrigin(reqWith({ host: "app.example.com", origin: "https://app.example.com:8443" })),
    ).toBe(false);
  });

  it("REJECTS an un-parseable Origin (URL constructor throws → caught → false)", () => {
    expect(isSameOrigin(reqWith({ host: "app.example.com", origin: "not a url" }))).toBe(false);
  });

  it("ACCEPTS a no-Origin request whose Sec-Fetch-Site is same-origin", () => {
    expect(
      isSameOrigin(reqWith({ host: "app.example.com", "sec-fetch-site": "same-origin" })),
    ).toBe(true);
  });

  it("REJECTS a no-Origin request whose Sec-Fetch-Site is cross-site", () => {
    expect(
      isSameOrigin(reqWith({ host: "app.example.com", "sec-fetch-site": "cross-site" })),
    ).toBe(false);
  });

  it("REJECTS a no-Origin request with same-site (not same-ORIGIN) fetch metadata", () => {
    expect(
      isSameOrigin(reqWith({ host: "app.example.com", "sec-fetch-site": "same-site" })),
    ).toBe(false);
  });

  it("REJECTS a request with neither Origin nor fetch metadata (fail closed)", () => {
    expect(isSameOrigin(reqWith({ host: "app.example.com" }))).toBe(false);
  });
});

describe("getSessionState — revocation + fail-open state machine", () => {
  it("returns status none when no session cookie is present", async () => {
    mockCookies.mockResolvedValue(fakeCookieStore(undefined).store);
    const state = await getSessionState();
    expect(state).toEqual({ session: null, status: "none" });
  });

  it("returns status expired (not none) for a present-but-undecodable cookie", async () => {
    // A garbage cookie value decodes to null — distinguished from 'none' so the UI can say "expired".
    mockCookies.mockResolvedValue(fakeCookieStore("garbage.notavalidhmac").store);
    const state = await getSessionState();
    expect(state.session).toBeNull();
    expect(state.status).toBe("expired");
  });

  it("REJECTS a version-mismatched (revoked) session: stored sv > token sv ⇒ expired", async () => {
    // The teeth behind server-side logout: a newer stored version kills the older-minted token.
    mockIsDbConfigured.mockReturnValue(true);
    mockGetSessionVersion.mockResolvedValue(5); // authority says current version is 5
    seedSession(activeSession({ sv: 3 })); // token was minted at version 3 → revoked
    const state = await getSessionState();
    expect(state).toEqual({ session: null, status: "expired" });
  });

  it("ALLOWS a current-version session whose access window is still open", async () => {
    mockIsDbConfigured.mockReturnValue(true);
    mockGetSessionVersion.mockResolvedValue(3); // matches token sv → not revoked
    seedSession(activeSession({ sv: 3 }));
    const state = await getSessionState();
    expect(state.status).toBe("active");
    expect(state.session?.login).toBe("octocat");
  });

  it("does NOT extend a spent token when the DB authority can't answer (unknown ⇒ expired)", async () => {
    // Past the short access exp + DB configured + version lookup throws (→ verdict 'unknown'):
    // an unaffirmed token must lapse at the access TTL, NOT survive to the 7-day horizon.
    mockIsDbConfigured.mockReturnValue(true);
    mockGetSessionVersion.mockRejectedValue(new Error("db blip"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = Date.now();
    seedSession(activeSession({ exp: now - 1_000, rexp: now + 86_400_000, sv: 3 }));
    const state = await getSessionState();
    expect(state).toEqual({ session: null, status: "expired" });
    expect(warn).toHaveBeenCalled(); // fail-open path is logged, not silent
  });

  it("re-mints a spent-but-affirmed token with a fresh access window (silent refresh)", async () => {
    // Past exp + verdict 'valid' ⇒ re-mint: new exp/rexp and status active. The cookie store's
    // set() is the re-mint; the returned expiresAt is the freshly slid horizon.
    mockIsDbConfigured.mockReturnValue(true);
    mockGetSessionVersion.mockResolvedValue(3); // affirmed
    const now = Date.now();
    const { set } = seedSession(activeSession({ exp: now - 1_000, rexp: now + 60_000, sv: 3 }));
    const state = await getSessionState();
    expect(state.status).toBe("active");
    expect(set).toHaveBeenCalledTimes(1); // re-mint written
    expect(state.session?.exp).toBeGreaterThan(now); // fresh access window
    expect(state.expiresAt ?? 0).toBeGreaterThan(now + 60_000); // horizon slid forward past the old rexp
    expect(state.needsRefresh).toBeUndefined();
  });

  it("in stateless mode (no DB) a spent token is governed by the inactivity horizon alone", async () => {
    // No DB authority ⇒ verdict 'unknown', but the DB-gate (now>=exp && isDbConfigured && !valid)
    // does NOT fire, so a token past its short exp but within rexp stays active and re-mints.
    mockIsDbConfigured.mockReturnValue(false);
    const now = Date.now();
    const { set } = seedSession(activeSession({ exp: now - 1_000, rexp: now + 86_400_000, sv: 0 }));
    const state = await getSessionState();
    expect(state.status).toBe("active");
    expect(set).toHaveBeenCalledTimes(1);
    expect(mockGetSessionVersion).not.toHaveBeenCalled(); // no revocation authority consulted
  });

  it("on a read-only cookie store (set throws) stays active with needsRefresh, NOT logged out", async () => {
    // Server Component render: the re-mint can't be written. The user must remain signed in and
    // the refresh deferred (needsRefresh) rather than abruptly dropped.
    mockIsDbConfigured.mockReturnValue(true);
    mockGetSessionVersion.mockResolvedValue(3);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = Date.now();
    seedSession(activeSession({ exp: now - 1_000, rexp: now + 86_400_000, sv: 3 }), {
      setImpl: () => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler");
      },
    });
    const state = await getSessionState();
    expect(state.status).toBe("active");
    expect(state.session?.login).toBe("octocat");
    expect(state.needsRefresh).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
