// The org switcher (POST /api/org/active) was dead in production. It validated the requested org against
// `orgOptionsForSession(getSession())` — the DORMANT custom-OAuth session — which is null under the
// ACTIVE Supabase wall, so the allowed list collapsed to ["public"] and every real org switch 400'd.
// It now validates with canReadOrg, the active-path read gate. The first two cases below both fail
// against the old code.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      const res = new Response(JSON.stringify(body), init);
      // The route sets a cookie via res.cookies.set; stub a minimal jar so we can assert on it.
      (res as unknown as { cookies: { set: ReturnType<typeof vi.fn> } }).cookies = { set: vi.fn() };
      return res;
    }
  },
}));

const { mockCanReadOrg } = vi.hoisted(() => ({ mockCanReadOrg: vi.fn() }));
vi.mock("@/lib/authz", () => ({ canReadOrg: mockCanReadOrg }));
// The route now delegates cross-origin detection to the shared isSameOrigin (it used to hand-roll its
// own copy) — pass through the REAL implementation so this file's cross-origin assertions keep exercising
// the same logic production uses.
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return {
    ACTIVE_ORG_COOKIE: "ascent_active_org",
    PUBLIC_ORG: "public",
    sessionMaxAgeSeconds: 3600,
    isSameOrigin: actual.isSameOrigin,
  };
});

import { POST } from "./route";

function post(body: unknown, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) {
  return POST(new Request("http://localhost/api/org/active", { method: "POST", headers, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanReadOrg.mockResolvedValue(false);
});

describe("POST /api/org/active", () => {
  it("PROD SHAPE: honors an org the Supabase viewer can read (was rejected pre-fix)", async () => {
    mockCanReadOrg.mockResolvedValue(true);
    const res = await post({ org: "Acme" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ org: "acme" }); // normalized to the stored lowercase slug
    expect(mockCanReadOrg).toHaveBeenCalledWith("acme");
  });

  it("rejects an org the viewer cannot read", async () => {
    mockCanReadOrg.mockResolvedValue(false);
    const res = await post({ org: "victim-org" });
    expect(res.status).toBe(400);
  });

  it("keeps PUBLIC_ORG in its canonical casing", async () => {
    mockCanReadOrg.mockResolvedValue(true);
    const res = await post({ org: "PUBLIC" });
    expect(await res.json()).toEqual({ org: "public" });
  });

  it("400s on a missing org and 403s cross-origin", async () => {
    expect((await post({})).status).toBe(400);
    const cross = await post({ org: "acme" }, { origin: "http://evil.example", host: "localhost" });
    expect(cross.status).toBe(403);
  });
});
