// Unit test for the single-sourced cron auth gate (requireCronAuth). The three scheduled routes
// (/api/cron/{purge,digest,rescan}) now share this one guard; each has ALREADY regressed to fail-open
// once when the gate was opt-in inline (`if (secret)`), so this pins the fail-CLOSED contract at the
// source: missing/empty CRON_SECRET → 503 (a denial response, never null), and a wrong/absent
// credential → 401, while only the exact `Bearer ${secret}` header is allowed through (returns null =
// proceed). next/server is mocked so we can read the status off the returned response.
//
// G8-48: the `?key=${secret}` channel is GONE by default (it leaks the secret into access/CDN/proxy
// logs, browser history and Referer headers) and the compare is constant-time. Both are pinned below,
// along with the CRON_ALLOW_QUERY_KEY escape hatch — the helper must be the STRICTEST gate in the
// codebase, since purge/digest adopted it on the strength of that promise.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Spy on the crypto primitive so we can assert the COMPARISON FUNCTION USED, not the timing.
const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

import { requireCronAuth } from "./cron-auth";

const SECRET = "cron-secret-xyz";

function req(opts: { auth?: string; key?: string } = {}) {
  const url = opts.key
    ? `http://localhost/api/cron/purge?key=${opts.key}`
    : "http://localhost/api/cron/purge";
  return new Request(url, {
    method: "GET",
    headers: opts.auth ? { authorization: opts.auth } : {},
  });
}

describe("requireCronAuth — fail-closed CRON_SECRET gate", () => {
  beforeEach(() => {
    crypto.timingSafeEqual.mockClear();
    process.env.CRON_SECRET = SECRET;
    delete process.env.CRON_ALLOW_QUERY_KEY;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.CRON_ALLOW_QUERY_KEY;
  });

  // ---- fail CLOSED when the secret is missing/empty -----------------------

  it("fails CLOSED with 503 when CRON_SECRET is UNSET", () => {
    delete process.env.CRON_SECRET;
    const res = requireCronAuth(req({ auth: `Bearer ${SECRET}` }));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(503);
  });

  it("fails CLOSED with 503 when CRON_SECRET is EMPTY", () => {
    process.env.CRON_SECRET = "";
    const res = requireCronAuth(req({ auth: "Bearer " }));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(503);
  });

  // ---- reject bad / absent credentials ------------------------------------

  it("rejects a wrong Bearer with 401", () => {
    const res = requireCronAuth(req({ auth: "Bearer wrong-secret" }));
    expect(res?.status).toBe(401);
  });

  it("rejects a wrong ?key= with 401", () => {
    const res = requireCronAuth(req({ key: "nope" }));
    expect(res?.status).toBe(401);
  });

  it("rejects a request with NO credential with 401", () => {
    const res = requireCronAuth(req());
    expect(res?.status).toBe(401);
  });

  it("does NOT accept the secret as a raw bearer (must be the `Bearer ${secret}` shape)", () => {
    const res = requireCronAuth(req({ auth: SECRET }));
    expect(res?.status).toBe(401);
  });

  // ---- authorize → null (proceed) -----------------------------------------

  it("authorizes a correct Bearer secret (returns null)", () => {
    expect(requireCronAuth(req({ auth: `Bearer ${SECRET}` }))).toBeNull();
  });

  // ---- G8-48: the `?key=` channel is refused by default ---------------------

  it("REFUSES a correct secret on the ?key= query param (401) — the channel is off by default", () => {
    const res = requireCronAuth(req({ key: SECRET }));
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });

  it("still refuses ?key= when the header is present but wrong", () => {
    const res = requireCronAuth(req({ key: SECRET, auth: "Bearer nope" }));
    expect(res?.status).toBe(401);
  });

  it("accepts a correct ?key= ONLY when CRON_ALLOW_QUERY_KEY opts in (deprecation escape hatch)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.CRON_ALLOW_QUERY_KEY = "1";
    expect(requireCronAuth(req({ key: SECRET }))).toBeNull();
    expect(warn).toHaveBeenCalled(); // every accepted query-param auth is loudly deprecated
    // A WRONG key is still refused with the hatch open.
    expect(requireCronAuth(req({ key: "nope" }))?.status).toBe(401);
    warn.mockRestore();
  });

  // ---- G8-48: the compare is constant-time --------------------------------

  it("compares the secret with crypto.timingSafeEqual, never `===`/`!==`", () => {
    expect(requireCronAuth(req({ auth: `Bearer ${SECRET}` }))).toBeNull();
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    const [a, b] = crypto.timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
    expect(Buffer.from(a).toString()).toBe(SECRET);
    expect(Buffer.from(b).toString()).toBe(SECRET);
  });

  it("skips timingSafeEqual on a LENGTH mismatch (it throws on unequal buffers) and still 401s", () => {
    const res = requireCronAuth(req({ auth: "Bearer short" }));
    expect(res?.status).toBe(401);
    expect(crypto.timingSafeEqual).not.toHaveBeenCalled();
  });

  it("uses timingSafeEqual for the equal-length wrong secret too", () => {
    const wrong = "x".repeat(SECRET.length);
    expect(requireCronAuth(req({ auth: `Bearer ${wrong}` }))?.status).toBe(401);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});
