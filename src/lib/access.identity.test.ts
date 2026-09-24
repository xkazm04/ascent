// resolveViewerIdentity: the login `resolveViewerLogin` resolves, plus the ONE email the auth provider
// has confirmed for that same person (operator decision 2026-09-24, the row 27 follow-up: the Developer
// home counts a session sent under the viewer's confirmed email as theirs).
//
// The email is a privacy key, so it is fenced here, server-side, before any loader sees it:
//   - only an address Supabase reports as confirmed (`email_confirmed_at`), reusing getViewer's rule;
//   - only when the Supabase viewer IS the resolved login (a custom-OAuth session carries no email, and
//     a Supabase viewer under a different login must not lend theirs to it);
//   - never under the dev bypass, whose address is synthetic, and never for an anonymous caller.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateSupabaseServerClient, mockGetSession } = vi.hoisted(() => ({
  mockCreateSupabaseServerClient: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mockCreateSupabaseServerClient }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mockGetSession }));

function fakeSupabase(user: Record<string, unknown> | null) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) } };
}

/** Fresh module per call: getViewer is React `cache()`-wrapped. */
async function freshResolve() {
  vi.resetModules();
  return (await import("./access")).resolveViewerIdentity;
}

const CONFIRMED = "2026-07-01T00:00:00Z";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  delete process.env.ASCENT_AUTH_BYPASS;
  mockGetSession.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.ASCENT_AUTH_BYPASS;
});

describe("resolveViewerIdentity", () => {
  it("returns the Supabase login with the email Supabase confirmed", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({ id: "u1", email: "ada@acme.io", email_confirmed_at: CONFIRMED, user_metadata: { user_name: "ada" } }),
    );
    expect(await (await freshResolve())()).toEqual({ login: "ada", confirmedEmail: "ada@acme.io" });
  });

  it("carries no email when Supabase has not confirmed it", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({ id: "u1", email: "grace@acme.io", email_confirmed_at: null, user_metadata: { user_name: "ada" } }),
    );
    expect(await (await freshResolve())()).toEqual({ login: "ada", confirmedEmail: null });
  });

  it("never lends a Supabase viewer's email to a different custom-OAuth login", async () => {
    mockGetSession.mockResolvedValue({ login: "linus" });
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({ id: "u1", email: "ada@acme.io", email_confirmed_at: CONFIRMED, user_metadata: { user_name: "ada" } }),
    );
    expect(await (await freshResolve())()).toEqual({ login: "linus", confirmedEmail: null });
  });

  it("keeps the email when the custom-OAuth login and the Supabase viewer are the same person", async () => {
    mockGetSession.mockResolvedValue({ login: "ada" });
    mockCreateSupabaseServerClient.mockResolvedValue(
      fakeSupabase({ id: "u1", email: "ada@acme.io", email_confirmed_at: CONFIRMED, user_metadata: { user_name: "ada" } }),
    );
    expect(await (await freshResolve())()).toEqual({ login: "ada", confirmedEmail: "ada@acme.io" });
  });

  it("guard: an anonymous caller resolves to no login and no email", async () => {
    mockCreateSupabaseServerClient.mockResolvedValue(fakeSupabase(null));
    expect(await (await freshResolve())()).toEqual({ login: null, confirmedEmail: null });
  });

  it("carries no email under the dev bypass, whose address is synthetic", async () => {
    process.env.ASCENT_AUTH_BYPASS = "1";
    expect(await (await freshResolve())()).toEqual({ login: "developer", confirmedEmail: null });
  });
});
