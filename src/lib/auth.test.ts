import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// auth.ts imports `cookies` from next/headers at module load; we never exercise the cookie store
// in these tests (only the pure encode/build/decode helpers), so stub it out to keep the import
// side-effect-free in a plain Node test environment.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  buildSession,
  encodeSession,
  decodeSession,
  safeNext,
  type Session,
  type UserInstallation,
} from "./auth";

// hmac() reads AUTH_SECRET lazily at call time, so setting it before the tests run is enough.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-auth-spec";
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
