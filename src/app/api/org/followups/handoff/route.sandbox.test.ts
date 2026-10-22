// POST /api/org/followups/handoff with origin "sandbox" (roadmap-1): the Roadmap Sandbox commits
// through THE ONE CLAIM PATH instead of a client loop of status-only PATCHes. The sandbox does not
// know the org, and a caller-supplied org beside caller-supplied ids is not trusted, so the org is
// RESOLVED FROM THE FIRST ID'S ROW and gated; `allOrNothingTenancy` then refuses the batch if any
// other id belongs elsewhere. The default branch (no origin) is unchanged and pinned in route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/auth", async () => ({ PUBLIC_ORG: (await import("@/lib/org-constants")).PUBLIC_ORG }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: vi.fn(() => null) }));
vi.mock("@/lib/db/followup-claims", () => ({ claimFollowups: vi.fn() }));
vi.mock("@/lib/db/scans-recommendations", () => ({ getRecommendationOrgSlug: vi.fn() }));

import { POST } from "./route";
import { claimFollowups } from "@/lib/db/followup-claims";
import { getRecommendationOrgSlug } from "@/lib/db/scans-recommendations";
import { requireOrgAccess } from "@/lib/authz";
import { PUBLIC_ORG } from "@/lib/org-constants";

const mockClaim = vi.mocked(claimFollowups);
const mockSlug = vi.mocked(getRecommendationOrgSlug);
const mockAccess = vi.mocked(requireOrgAccess);

const post = (body: unknown) =>
  POST(new Request("http://x/api/org/followups/handoff", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  mockClaim.mockReset().mockResolvedValue({ claimed: [], refused: [] });
  mockSlug.mockReset().mockResolvedValue("acme");
  mockAccess.mockReset().mockResolvedValue(null);
});

describe("POST handoff origin 'sandbox': resolve-then-gate, one claim, the signed sandbox note", () => {
  it("resolves the org from the first id's row, gates it, and claims once as an unleased human", async () => {
    const res = await post({ ids: ["A", "B"], origin: "sandbox", projectedDelta: -3.2 });
    expect(res.status).toBe(200);
    expect(mockSlug).toHaveBeenCalledWith("A");
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        ids: ["A", "B"],
        actor: "alice",
        executor: "human",
        leaseMs: null,
        allOrNothingTenancy: true,
        note: "Committed from sandbox simulation, projected -3 pts overall.",
      }),
    );
  });

  it("ignores a caller-supplied org: the row's org is the one gated", async () => {
    await post({ org: "evil", ids: ["A"], origin: "sandbox", projectedDelta: 2 });
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockClaim.mock.calls[0]![0].org).toBe("acme");
  });

  it("a public-org row is 403 and nothing is claimed", async () => {
    mockSlug.mockResolvedValue(PUBLIC_ORG);
    expect((await post({ ids: ["A"], origin: "sandbox", projectedDelta: 1 })).status).toBe(403);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("an unknown first id is 403, the same answer as a foreign one", async () => {
    mockSlug.mockResolvedValue(null);
    const res = await post({ ids: ["nope"], origin: "sandbox", projectedDelta: 1 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "One or more items do not belong to this organization." });
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("an `unknown` refusal from the claim (a later id is foreign) is the whole-request 403", async () => {
    mockClaim.mockResolvedValue({ claimed: [], refused: [{ id: "A", reason: "unknown" }, { id: "F", reason: "unknown" }] });
    expect((await post({ ids: ["A", "F"], origin: "sandbox", projectedDelta: 1 })).status).toBe(403);
  });

  it("a gate refusal wins", async () => {
    mockAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }) as never);
    expect((await post({ ids: ["A"], origin: "sandbox", projectedDelta: 1 })).status).toBe(403);
    expect(mockClaim).not.toHaveBeenCalled();
  });
});

describe("POST handoff: the origin field is validated, the default branch untouched", () => {
  it("origin 'sandbox' with a non-finite projectedDelta, or any other origin, is 400 before any read", async () => {
    expect((await post({ ids: ["A"], origin: "sandbox" })).status).toBe(400);
    expect((await post({ ids: ["A"], origin: "sandbox", projectedDelta: "3" })).status).toBe(400);
    expect((await post({ ids: ["A"], origin: "sandbox", projectedDelta: null })).status).toBe(400);
    expect((await post({ ids: ["A"], origin: "other", projectedDelta: 1 })).status).toBe(400);
    expect((await post({ ids: [], origin: "sandbox", projectedDelta: 1 })).status).toBe(400);
    expect(mockSlug).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("guard: without origin the note and the gated org are the ledger's, unchanged", async () => {
    await post({ org: "acme", ids: ["A"] });
    expect(mockSlug).not.toHaveBeenCalled();
    expect(mockClaim.mock.calls[0]![0].note).toBe("Handed off: fix prompt generated from the Follow-ups ledger");
  });
});
