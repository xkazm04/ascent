// /api/org/controls — the gate runs BEFORE any ledger read, and coverage always ships beside the
// timeline. The second invariant is the substantive one: a timeline without its coverage invites a
// claim ("branch protection held all quarter") the observation count would not support, so the route
// is pinned to return both, and to compute coverage over the UNFILTERED window even when the caller
// asked for transitions only.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn() }));
vi.mock("@/lib/db/control-observations", () => ({
  listControlTimeline: vi.fn(),
  controlCoverage: vi.fn(),
  TIMELINE_CAP: 2000,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured } from "@/lib/db";
import { controlCoverage, listControlTimeline } from "@/lib/db/control-observations";
import { requireOrgRead } from "@/lib/authz";

const mockIsDb = vi.mocked(isDbConfigured);
const mockTimeline = vi.mocked(listControlTimeline);
const mockCoverage = vi.mocked(controlCoverage);
const mockGate = vi.mocked(requireOrgRead);

const get = (qs: string) => GET(new Request(`http://localhost/api/org/controls${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDb.mockReturnValue(true);
  mockGate.mockResolvedValue(null);
  mockTimeline.mockResolvedValue([]);
  mockCoverage.mockResolvedValue([]);
});

describe("pre-gate short circuits", () => {
  it("503s without a database, before the gate", async () => {
    mockIsDb.mockReturnValue(false);
    expect((await get("?org=acme")).status).toBe(503);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("400s without an org", async () => {
    expect((await get("")).status).toBe(400);
    expect(mockGate).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("returns the denial VERBATIM and never reads the ledger", async () => {
    const denial = new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    mockGate.mockResolvedValue(denial);
    expect(await get("?org=acme")).toBe(denial);
    expect(mockTimeline).not.toHaveBeenCalled();
    expect(mockCoverage).not.toHaveBeenCalled();
  });
});

describe("the response", () => {
  it("always carries coverage beside the timeline", async () => {
    mockCoverage.mockResolvedValue([
      {
        repoFullName: "acme/api",
        controlId: "branch-protection",
        firstObservedAt: "2026-08-01T00:00:00.000Z",
        lastObservedAt: "2026-08-09T00:00:00.000Z",
        observations: 3,
        sources: ["probe"],
        maxGapDays: 7,
        lastState: "pass",
      },
    ]);
    const body = await (await get("?org=acme")).json();
    expect(body.coverage[0]).toMatchObject({ observations: 3, maxGapDays: 7 });
  });

  it("does NOT narrow coverage by transitionsOnly — heartbeats are what prove a control held", async () => {
    await get("?org=acme&transitionsOnly=1");
    expect(mockTimeline).toHaveBeenCalledWith("acme", expect.objectContaining({ transitionsOnly: true }));
    expect(mockCoverage).toHaveBeenCalledWith("acme", expect.not.objectContaining({ transitionsOnly: expect.anything() }));
  });

  it("flags truncation rather than presenting a capped page as everything", async () => {
    mockTimeline.mockResolvedValue(Array.from({ length: 5 }, () => ({}) as never));
    const body = await (await get("?org=acme&limit=5")).json();
    expect(body.truncated).toBe(true);
    expect(body.limit).toBe(5);
  });

  it("is not truncated when the page came back short", async () => {
    mockTimeline.mockResolvedValue([{} as never]);
    expect((await (await get("?org=acme&limit=5")).json()).truncated).toBe(false);
  });

  it("passes the repo/control/window filters through", async () => {
    await get("?org=acme&repo=acme/api&controlId=signed-commits&from=2026-08-01&to=2026-08-31");
    expect(mockTimeline).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ repoFullName: "acme/api", controlId: "signed-commits", from: "2026-08-01", to: "2026-08-31" }),
    );
  });
});
