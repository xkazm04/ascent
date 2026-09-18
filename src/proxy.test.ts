// The proxy used to call supabase.auth.getUser() on every non-static path, including POST
// /api/app/webhook (GitHub), /api/cron/* (Vercel), and /api/badge (anonymous embed). Those have
// no session cookie; the auth-server round-trip is wasted work. skipCookieRefresh is the extracted
// predicate so the skip list is unit-testable without spinning up the proxy. /org/* document
// navigations must keep refreshing — dropping them would silently sign people out mid-session.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateServerClient, mockAuthGateEnabled, mockNext } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockAuthGateEnabled: vi.fn(() => true),
  mockNext: vi.fn((init?: { request?: unknown }) => ({
    cookies: { set: vi.fn() },
    request: init?.request,
  })),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mockCreateServerClient }));
vi.mock("@/lib/env", () => ({ authGateEnabled: mockAuthGateEnabled }));
vi.mock("next/server", () => ({
  NextResponse: { next: (...args: unknown[]) => mockNext(...args) },
}));

import { config, proxy, skipCookieRefresh } from "./proxy";

function req(pathname: string): NextRequest {
  return {
    nextUrl: { pathname },
    cookies: { getAll: () => [], set: vi.fn() },
  } as unknown as NextRequest;
}

/** Compile the Next matcher as a JS regex — the pattern is already a regex-shaped string literal. */
function matcherRuns(pathname: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(pathname);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthGateEnabled.mockReturnValue(true);
  mockCreateServerClient.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  });
});

describe("skipCookieRefresh — cookie-free inbound APIs", () => {
  it("skips the GitHub App webhook", () => {
    expect(skipCookieRefresh("/api/app/webhook")).toBe(true);
    expect(skipCookieRefresh("/api/app/webhook/")).toBe(true);
  });

  it("skips Vercel cron routes", () => {
    expect(skipCookieRefresh("/api/cron")).toBe(true);
    expect(skipCookieRefresh("/api/cron/purge")).toBe(true);
    expect(skipCookieRefresh("/api/cron/digest")).toBe(true);
    expect(skipCookieRefresh("/api/cron/rescan")).toBe(true);
  });

  it("skips the anonymous badge API", () => {
    expect(skipCookieRefresh("/api/badge")).toBe(true);
    expect(skipCookieRefresh("/api/badge/acme/repo")).toBe(true);
  });

  it("skips the Polar billing webhook (cookie-free inbound)", () => {
    expect(skipCookieRefresh("/api/billing/webhook")).toBe(true);
  });

  it("does not skip neighbouring App or auth routes", () => {
    expect(skipCookieRefresh("/api/app/setup")).toBe(false);
    expect(skipCookieRefresh("/api/app/repos")).toBe(false);
    expect(skipCookieRefresh("/api/auth/session")).toBe(false);
    expect(skipCookieRefresh("/api/org/active")).toBe(false);
  });

  it("does not skip /org/* document navigations", () => {
    expect(skipCookieRefresh("/org")).toBe(false);
    expect(skipCookieRefresh("/org/acme")).toBe(false);
    expect(skipCookieRefresh("/org/acme/overview")).toBe(false);
  });

  it("does not skip other browser routes", () => {
    expect(skipCookieRefresh("/")).toBe(false);
    expect(skipCookieRefresh("/pricing")).toBe(false);
    expect(skipCookieRefresh("/auth/callback")).toBe(false);
  });
});

describe("matcher — same skip list, /org/* still runs", () => {
  it("does not run the proxy on webhook, cron, or badge", () => {
    expect(matcherRuns("/api/app/webhook")).toBe(false);
    expect(matcherRuns("/api/cron/purge")).toBe(false);
    expect(matcherRuns("/api/badge")).toBe(false);
    expect(matcherRuns("/api/badge/acme/repo")).toBe(false);
  });

  it("still runs the proxy on /org/* document navigations", () => {
    expect(matcherRuns("/org/acme")).toBe(true);
    expect(matcherRuns("/org/acme/overview")).toBe(true);
  });

  it("still excludes static assets", () => {
    expect(matcherRuns("/_next/static/chunk.js")).toBe(false);
    expect(matcherRuns("/favicon.ico")).toBe(false);
    expect(matcherRuns("/logo.png")).toBe(false);
  });
});

describe("proxy() — short-circuit before createServerClient", () => {
  it("does not mint a Supabase client on webhook, cron, or badge", async () => {
    await proxy(req("/api/app/webhook"));
    await proxy(req("/api/cron/purge"));
    await proxy(req("/api/badge"));
    expect(mockCreateServerClient).not.toHaveBeenCalled();
  });

  it("still refreshes cookies on /org/* document navigations", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    mockCreateServerClient.mockReturnValue({ auth: { getUser } });

    await proxy(req("/org/acme"));

    expect(mockCreateServerClient).toHaveBeenCalled();
    expect(getUser).toHaveBeenCalled();
  });
});
