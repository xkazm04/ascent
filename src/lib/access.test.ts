// getViewer's email is a SECURITY value, not a display value: acceptInvite binds an email-pinned org
// invite to it ("the viewer's VERIFIED email"). Supabase populates `user.email` at registration time
// whether or not the address was ever confirmed, so passing it through let an attacker register an
// UNCONFIRMED victim@example.com account and claim an invite meant for the victim. These tests pin the
// confirmation check: `email` is surfaced only when `email_confirmed_at` is set.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateSupabaseServerClient, mockHeaders } = vi.hoisted(() => ({
  mockCreateSupabaseServerClient: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mockCreateSupabaseServerClient }));
vi.mock("next/headers", () => ({ headers: mockHeaders }));

/** A Supabase server-client double whose getUser() returns the given user row. */
function fakeSupabase(user: Record<string, unknown> | null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) } };
}

/** Fresh module instance per call — getViewer is React `cache()`-wrapped, so a single import would
 *  memoize the first viewer across tests. */
async function freshGetViewer() {
  vi.resetModules();
  const mod = await import("./access");
  return mod.getViewer;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Supabase configured + bypass off ⇒ the real login-wall path (not DEV_VIEWER).
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  delete process.env.ASCENT_AUTH_BYPASS;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("getViewer — only a CONFIRMED Supabase email is surfaced", () => {
  it("omits the email when Supabase reports it unconfirmed (email_confirmed_at null)", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({
        id: "u_attacker",
        email: "victim@example.com",
        email_confirmed_at: null,
        user_metadata: { user_name: "attacker" },
      }),
    );
    const getViewer = await freshGetViewer();

    const viewer = await getViewer();

    expect(viewer?.login).toBe("attacker"); // still signed in — only the unproven address is dropped
    expect(viewer?.email).toBeUndefined();
  });

  it("surfaces the email when Supabase reports it confirmed", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({
        id: "u_victim",
        email: "victim@example.com",
        email_confirmed_at: "2026-07-01T00:00:00Z",
        user_metadata: { user_name: "victim" },
      }),
    );
    const getViewer = await freshGetViewer();

    expect((await getViewer())?.email).toBe("victim@example.com");
  });

  it("omits the email when the confirmation timestamp is absent entirely", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({ id: "u_x", email: "x@example.com", user_metadata: {} }),
    );
    const getViewer = await freshGetViewer();

    expect((await getViewer())?.email).toBeUndefined();
  });
});

// G6-12: a lapsed session hitting a gated route must get a redirect on a top-level NAVIGATION and a
// bare 401 JSON on a programmatic fetch/XHR call — never the other way around (a redirect handed to a
// fetch caller would be silently `follow`ed and misread as a 200 success).
describe("requireViewer — navigation vs. XHR discrimination (G6-12)", () => {
  async function freshRequireViewer() {
    vi.resetModules();
    const mod = await import("./access");
    return mod.requireViewer;
  }

  function mockRequestHeaders(entries: Record<string, string>) {
    const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
    mockHeaders.mockResolvedValue({ get: (key: string) => map.get(key.toLowerCase()) ?? null });
  }

  beforeEach(() => {
    // No viewer: every call in this describe block exercises the signed-out path.
    mockCreateSupabaseServerClient.mockResolvedValue(fakeSupabase(null));
  });

  it("a top-level navigation (Sec-Fetch-Mode: navigate) gets a 303 redirect to /connect, not JSON", async () => {
    mockRequestHeaders({ "sec-fetch-mode": "navigate", host: "app.example.com", "x-forwarded-proto": "https" });
    const requireViewer = await freshRequireViewer();

    const res = await requireViewer();

    expect(res).not.toBeNull();
    expect(res!.status).toBe(303);
    expect(res!.headers.get("location")).toBe("https://app.example.com/connect");
  });

  it("a same-origin fetch (Sec-Fetch-Mode: cors) still gets the bare 401 JSON, never a redirect", async () => {
    mockRequestHeaders({ "sec-fetch-mode": "cors", host: "app.example.com" });
    const requireViewer = await freshRequireViewer();

    const res = await requireViewer();

    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body).toEqual({ error: "Sign in to continue." });
  });

  it("an XHR with no Sec-Fetch-Mode but a JSON Accept header gets the 401 JSON, not a redirect", async () => {
    mockRequestHeaders({ accept: "application/json", host: "app.example.com" });
    const requireViewer = await freshRequireViewer();

    expect((await requireViewer())!.status).toBe(401);
  });

  it("falls back to Accept: text/html when Sec-Fetch-Mode is absent (older browser navigation)", async () => {
    mockRequestHeaders({ accept: "text/html,application/xhtml+xml", host: "app.example.com" });
    const requireViewer = await freshRequireViewer();

    const res = await requireViewer();
    expect(res!.status).toBe(303);
  });

  it("never redirects to an attacker-controlled Host — falls back to JSON 401 when the forwarded host fails the hostname grammar", async () => {
    mockRequestHeaders({
      "sec-fetch-mode": "navigate",
      host: "app.example.com",
      "x-forwarded-host": "evil.example.com/\\@attacker.test",
    });
    const requireViewer = await freshRequireViewer();

    const res = await requireViewer();
    // The malformed forwarded host is rejected; falls back to the trusted `host` header.
    expect(res!.status).toBe(303);
    expect(res!.headers.get("location")).toBe("https://app.example.com/connect");
  });
});
