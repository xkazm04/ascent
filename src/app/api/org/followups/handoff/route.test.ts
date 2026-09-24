// POST /api/org/followups/handoff goes through THE ONE CLAIM PATH (backlog develop-2026-09-17 row 32).
//
// Before this, the route called `handoffRecommendations`, which moved `status` to `in_progress` and
// wrote no claim column, so the ledger's ClaimLine stayed blank after a browser hand-off and an agent
// reading the row could not tell who had taken it. The route now claims as executor `human` with no
// lease (the shape `sweepExpiredLeases` never reclaims), holder = the viewer's login, and asks for
// whole-request tenancy so one foreign id is still a whole-request 403 with nothing touched.
//
// The data layer is mocked here: its compare-and-set, the unleased-human shape and the all-or-nothing
// refusal are pinned against a fake Prisma in src/lib/db/followup-claims.test.ts.

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
// The pre-fix data call, stubbed so a route still using it fails on the ASSERTIONS, not on an import.
vi.mock("@/lib/db", () => ({ handoffRecommendations: vi.fn(async (_o: string, ids: string[]) => ({ ok: true, marked: ids, skipped: [] })) }));

import { POST } from "./route";
import { claimFollowups } from "@/lib/db/followup-claims";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { PUBLIC_ORG } from "@/lib/org-constants";

const mockClaim = vi.mocked(claimFollowups);
const mockAccess = vi.mocked(requireOrgAccess);
const mockLogin = vi.mocked(resolveViewerLogin);

const post = (body: unknown) =>
  POST(new Request("http://x/api/org/followups/handoff", { method: "POST", body: JSON.stringify(body) }));

const claimedRow = (id: string) => ({
  id,
  repo: "acme/api",
  title: "t",
  claimActor: "alice",
  claimExecutor: "human" as const,
  leaseUntil: null,
  needsHuman: false,
});

beforeEach(() => {
  mockClaim.mockReset();
  mockAccess.mockReset().mockResolvedValue(null);
  mockLogin.mockReset().mockResolvedValue("alice");
});

describe("POST /api/org/followups/handoff: the browser claim runs through claimFollowups", () => {
  it("claims as executor human, unleased, held by the viewer, with whole-request tenancy on the gated org", async () => {
    mockClaim.mockResolvedValue({ claimed: [claimedRow("a"), claimedRow("b")], refused: [] });
    const res = await post({ org: " Acme ", ids: ["a", "b"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marked: ["a", "b"], skipped: [] });
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        ids: ["a", "b"],
        actor: "alice",
        executor: "human",
        leaseMs: null,
        allOrNothingTenancy: true,
      }),
    );
    expect(mockClaim.mock.calls[0]![0].note).toMatch(/Handed off/);
  });

  it("reports rows the claim path refused as held or not-open in `skipped`, never as marked", async () => {
    mockClaim.mockResolvedValue({
      claimed: [claimedRow("a")],
      refused: [
        { id: "b", reason: "held" },
        { id: "c", reason: "not-open" },
      ],
    });
    const res = await post({ org: "acme", ids: ["a", "b", "c"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      marked: ["a"],
      skipped: [
        { id: "b", reason: "held" },
        { id: "c", reason: "not-open" },
      ],
    });
  });

  it("maps ANY `unknown` refusal to the whole-request 403 (no existence oracle)", async () => {
    mockClaim.mockResolvedValue({
      claimed: [],
      refused: [
        { id: "a", reason: "unknown" },
        { id: "zz", reason: "unknown" },
      ],
    });
    const res = await post({ org: "acme", ids: ["a", "zz"] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "One or more items do not belong to this organization." });
  });

  it("an org the database does not know gets the same 403 (dbGuard already answered the no-database case)", async () => {
    mockClaim.mockResolvedValue(null);
    const res = await post({ org: "acme", ids: ["a"] });
    expect(res.status).toBe(403);
  });

  it("holds the claim under a stable label when the viewer has no login, never a blank holder", async () => {
    mockLogin.mockResolvedValue(null);
    mockClaim.mockResolvedValue({ claimed: [claimedRow("a")], refused: [] });
    await post({ org: "acme", ids: ["a"] });
    const actor = mockClaim.mock.calls[0]![0].actor;
    expect(typeof actor).toBe("string");
    expect(actor.length).toBeGreaterThan(0);
  });

  it("guard: the gate refusal wins and nothing is claimed", async () => {
    mockAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }) as never);
    const res = await post({ org: "acme", ids: ["a"] });
    expect(res.status).toBe(403);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("guard: the public funnel org, a missing org, no ids and an oversized batch are refused before any claim", async () => {
    expect((await post({ org: PUBLIC_ORG, ids: ["a"] })).status).toBe(403);
    expect((await post({ ids: ["a"] })).status).toBe(400);
    expect((await post({ org: "acme", ids: [] })).status).toBe(400);
    expect((await post({ org: "acme", ids: Array.from({ length: 51 }, (_, i) => `r${i}`) })).status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
