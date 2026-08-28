// GET /api/org/repos — the public, App-free org listing behind the onboarding selector.
//
// This route is deliberately unauthenticated, which is why the limiter matters: `listOrgRepos` pages
// up to 5 x 100 repos against the server's AMBIENT GITHUB_TOKEN, so an anonymous loop over invented
// org names spends the OPERATOR's GitHub quota rather than the caller's. It was the last public
// endpoint without a limiter while its siblings (badge, gate, scorecard) all had one.
// Architect ADR 2026-08-28-boundary-residuals.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/github/list", () => ({
  listOrgRepos: vi.fn(async () => ({ repos: [{ name: "a" }], truncated: false })),
  GitHubListError: class GitHubListError extends Error {
    code: string;
    retryAfterSec?: number;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock("@/lib/db/org-shared", () => ({ normalizeOrgSlug: (s: string) => s.trim().toLowerCase() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true })),
  tooManyRequests: vi.fn(() => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 })),
  ORG_REPOS_RATE_LIMIT: {},
}));

import { GET } from "./route";
import { listOrgRepos } from "@/lib/github/list";
import { rateLimitRequest } from "@/lib/rate-limit";

const req = (url: string) => new Request(url);

beforeEach(() => {
  // mockReturnValue does NOT reset call history — clear both, or the "did not spend a slot"
  // assertion below reads the previous test's call.
  vi.mocked(rateLimitRequest).mockClear();
  vi.mocked(rateLimitRequest).mockReturnValue({ ok: true } as ReturnType<typeof rateLimitRequest>);
  vi.mocked(listOrgRepos).mockClear();
});

describe("GET /api/org/repos", () => {
  it("lists repos for a valid org", async () => {
    const res = await GET(req("https://x.test/api/org/repos?org=vercel"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ org: "vercel", truncated: false });
  });

  it("400s a missing org WITHOUT spending a limiter slot", async () => {
    const res = await GET(req("https://x.test/api/org/repos"));
    expect(res.status).toBe(400);
    // The cheap argument check runs first: a malformed request must not consume the budget that
    // protects the expensive upstream call.
    expect(rateLimitRequest).not.toHaveBeenCalled();
  });

  it("429s when the limiter refuses, without touching GitHub", async () => {
    vi.mocked(rateLimitRequest).mockReturnValue({ ok: false } as ReturnType<typeof rateLimitRequest>);
    const res = await GET(req("https://x.test/api/org/repos?org=vercel"));
    expect(res.status).toBe(429);
    // The whole point: a throttled caller must not reach the ambient-token fan-out.
    expect(listOrgRepos).not.toHaveBeenCalled();
  });
});
