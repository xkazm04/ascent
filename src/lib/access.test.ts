// getViewer's email is a SECURITY value, not a display value: acceptInvite binds an email-pinned org
// invite to it ("the viewer's VERIFIED email"). Supabase populates `user.email` at registration time
// whether or not the address was ever confirmed, so passing it through let an attacker register an
// UNCONFIRMED victim@example.com account and claim an invite meant for the victim. These tests pin the
// confirmation check: `email` is surfaced only when `email_confirmed_at` is set.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateSupabaseServerClient } = vi.hoisted(() => ({
  mockCreateSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mockCreateSupabaseServerClient }));

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
