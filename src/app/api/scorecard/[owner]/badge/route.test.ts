// The org scorecard badge is the most-copied artifact in the growth loop — it ends up in READMEs where
// nobody re-reads it. So the honesty rules are pinned here, not left to review:
//
//  - a number is drawn ONLY when a model produced one (verifiedCount > 0);
//  - an owner whose public scans are all deterministic previews gets a neutral "preview only" badge,
//    never an average over previews;
//  - `?color=` cannot repaint a resolved verdict (the scope rule the per-repo badge documents);
//  - the badge reads the PUBLIC corpus reader only — it has no path to a tenant/private aggregate.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getPublicOrgScorecard, rateLimitRequest } = vi.hoisted(() => ({
  getPublicOrgScorecard: vi.fn(),
  rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
}));

vi.mock("@/lib/register/data", () => ({ getPublicOrgScorecard }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitRequest, BADGE_RATE_LIMIT: { limit: 60, windowMs: 60_000 } }));

import { GET } from "./route";

const card = (over: Record<string, unknown> = {}) => ({
  owner: "acme",
  avgOverall: 72,
  avgAdoption: 60,
  avgRigor: 80,
  dimensions: { D1: 72 },
  level: "L4",
  levelName: "Integrated",
  repoCount: 3,
  verifiedCount: 3,
  scannedAt: "2026-07-20T00:00:00.000Z",
  repos: [],
  ...over,
});

const call = async (owner: string, query = "") => {
  const res = await GET(new Request(`https://ascent.test/api/scorecard/${owner}/badge${query}`), {
    params: Promise.resolve({ owner }),
  });
  return { res, svg: await res.text() };
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitRequest.mockReturnValue({ ok: true, retryAfterSec: 0 });
});

describe("GET /api/scorecard/:owner/badge", () => {
  it("renders the aggregate level when a model scored the corpus", async () => {
    getPublicOrgScorecard.mockResolvedValue(card());
    const { res, svg } = await call("acme");

    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(svg).toContain("L4 Integrated");
    // Click-through back to the scorecard, attributable like the repo badge's ?ref=badge.
    expect(svg).toContain("https://ascent.test/scorecard/acme?ref=badge");
  });

  it("REFUSES a number when every public scan was a deterministic preview", async () => {
    getPublicOrgScorecard.mockResolvedValue(card({ verifiedCount: 0, avgOverall: 0 }));
    const { svg } = await call("acme");

    expect(svg).toContain("preview only");
    expect(svg).not.toContain("/100");
    expect(svg).not.toMatch(/L[1-5] /);
  });

  it("renders a neutral badge for an owner with no public scans", async () => {
    getPublicOrgScorecard.mockResolvedValue(null);
    const { svg, res } = await call("nobody");
    expect(svg).toContain("not scored");
    // Short TTL — "not scored" may stop being true at any moment.
    expect(res.headers.get("cache-control")).toContain("max-age=30");
  });

  it("rejects a malformed owner BEFORE touching the data layer", async () => {
    const { svg } = await call("..");
    expect(svg).toContain("unknown");
    expect(getPublicOrgScorecard).not.toHaveBeenCalled();
  });

  it("never lets ?color= repaint a resolved level verdict", async () => {
    getPublicOrgScorecard.mockResolvedValue(card({ level: "L1", levelName: "Ad-hoc", avgOverall: 12 }));
    const { svg } = await call("acme", "?color=brightgreen");
    expect(svg).toContain("L1 Ad-hoc");
    // The L5 brightgreen fill must not appear — the level's own colour wins.
    expect(svg).not.toContain("#22c55e");
  });

  it("serves a cheap 429 badge instead of a DB read when rate limited", async () => {
    rateLimitRequest.mockReturnValue({ ok: false, retryAfterSec: 30 });
    const { res, svg } = await call("acme");
    expect(res.status).toBe(429);
    expect(svg).toContain("rate limited");
    expect(getPublicOrgScorecard).not.toHaveBeenCalled();
  });

  it("reads ONLY the public-corpus scorecard reader (no tenant/org aggregate path exists)", async () => {
    getPublicOrgScorecard.mockResolvedValue(card());
    await call("ACME");
    // Lower-cased owner, routed through the public register reader — the one function whose every
    // query is pinned to the public org + isPrivate:false.
    expect(getPublicOrgScorecard).toHaveBeenCalledWith("acme");
  });
});
