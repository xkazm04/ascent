import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// auth.ts imports `cookies` from next/headers at module load; we never exercise the cookie store
// in these tests (only the pure encode/build/decode helpers), so stub it out to keep the import
// side-effect-free in a plain Node test environment.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { buildSession, encodeSession, decodeSession, type Session, type UserInstallation } from "./auth";

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

describe("buildSession", () => {
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
