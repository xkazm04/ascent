// Tenant-gate test for GET /api/recommendations/:id/events (roadmap-recommendation-tracking #2, Critical).
// The activity timeline (assignee logins, free-text notes, due-date history) is per-tenant data, so the
// route resolves the OWNING org from the id and gates on requireOrgRead (the READ-side gate — NOT
// requireOrgAccess). This pins: unknown id → 404; a denied org → that exact Response, with the events
// query never run; an authorized in-org read → the events list. Closes the cross-tenant read IDOR.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getRecommendationOrgSlug: vi.fn(),
  getRecommendationEvents: vi.fn(),
}));

// The events GET must use requireOrgRead (read gate), NOT requireOrgAccess. We mock BOTH so we can
// assert the read gate is the one consulted and the mutating gate is never touched on a read path.
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(), requireOrgAccess: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured, getRecommendationOrgSlug, getRecommendationEvents } from "@/lib/db";
import { requireOrgRead, requireOrgAccess } from "@/lib/authz";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockOrgSlug = vi.mocked(getRecommendationOrgSlug);
const mockEvents = vi.mocked(getRecommendationEvents);
const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockRequireOrgAccess = vi.mocked(requireOrgAccess);

function get(id: string) {
  return GET(new Request(`http://localhost/api/recommendations/${id}/events`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockOrgSlug.mockResolvedValue("acme" as never);
  mockRequireOrgRead.mockResolvedValue(null);
  mockEvents.mockResolvedValue([] as never);
});

describe("GET /api/recommendations/:id/events — read tenant gate", () => {
  it("503s and never resolves the owning org when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("rec_1");
    expect(res.status).toBe(503);
    expect(mockOrgSlug).not.toHaveBeenCalled();
    expect(mockEvents).not.toHaveBeenCalled();
  });

  it("404s an unknown id and never reads the timeline", async () => {
    mockOrgSlug.mockResolvedValue(null as never);
    const res = await get("rec_unknown");
    expect(res.status).toBe(404);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockEvents).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT READ IDOR: gates on the row's owning org via requireOrgRead; denial blocks the read", async () => {
    mockOrgSlug.mockResolvedValue("victim-org" as never);
    const denial = new Response(JSON.stringify({ error: "no read access" }), { status: 403 });
    mockRequireOrgRead.mockResolvedValue(denial as never);
    const res = await get("rec_1");
    expect(res).toBe(denial); // exact denial returned verbatim
    expect(mockRequireOrgRead).toHaveBeenCalledWith("victim-org"); // gated on the row's true org
    expect(mockRequireOrgAccess).not.toHaveBeenCalled(); // read path uses the READ gate, not the mutate gate
    expect(mockEvents).not.toHaveBeenCalled(); // no cross-tenant timeline read
  });

  it("authorized in-org read returns the events list and uses requireOrgRead (not requireOrgAccess)", async () => {
    mockEvents.mockResolvedValue([{ id: "ev_1", kind: "status" }] as never);
    const res = await get("rec_1");
    expect(res.status).toBe(200);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockEvents).toHaveBeenCalledWith("rec_1");
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });
});
