// Unit test for the single-sourced cron auth gate (requireCronAuth). The three scheduled routes
// (/api/cron/{purge,digest,rescan}) now share this one guard; each has ALREADY regressed to fail-open
// once when the gate was opt-in inline (`if (secret)`), so this pins the fail-CLOSED contract at the
// source: missing/empty CRON_SECRET → 503 (a denial response, never null), and a wrong/absent
// credential → 401, while only the exact `Bearer ${secret}` or `?key=${secret}` is allowed through
// (returns null = proceed). next/server is mocked so we can read the status off the returned response.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
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

  it("authorizes a correct ?key= secret (returns null)", () => {
    expect(requireCronAuth(req({ key: SECRET }))).toBeNull();
  });
});
