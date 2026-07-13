// PATCH /api/org/initiatives/[id] — pins the two correctness gates added in goals-initiatives #5/#7:
//   #7 a `goalId` link must reference a Goal in the SAME org as the initiative (no cross-org foreign
//      key); a foreign/unknown id is rejected 400 and never written.
//   #5 `targetDate` must be a real YYYY-MM-DD calendar day, not any parseable datetime.
// The db/authz boundaries are mocked so we assert exactly when updateInitiative fires.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  getGoalOrgSlug: vi.fn(),
  getInitiativeOrgSlug: vi.fn(),
  isDbConfigured: vi.fn(() => true),
  updateInitiative: vi.fn(async () => true),
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));

import { PATCH } from "./route";
import { getGoalOrgSlug, getInitiativeOrgSlug, updateInitiative } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockGoalOrg = vi.mocked(getGoalOrgSlug);
const mockInitOrg = vi.mocked(getInitiativeOrgSlug);
const mockUpdate = vi.mocked(updateInitiative);
const mockAccess = vi.mocked(requireOrgAccess);

const ctx = { params: Promise.resolve({ id: "init_1" }) };
function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/org/initiatives/init_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInitOrg.mockResolvedValue("acme"); // the initiative belongs to org "acme"
  mockAccess.mockResolvedValue(null); // caller is authorized
  mockUpdate.mockResolvedValue(true);
});

describe("PATCH — cross-org goalId (goals-initiatives #7)", () => {
  it("rejects a goalId that belongs to a DIFFERENT org (400) and writes nothing", async () => {
    mockGoalOrg.mockResolvedValue("victim"); // the goal lives in another org

    const res = await patch({ goalId: "goal_x" });

    expect(res.status).toBe(400);
    expect(mockGoalOrg).toHaveBeenCalledWith("goal_x");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown goalId (getGoalOrgSlug → null) with 400", async () => {
    mockGoalOrg.mockResolvedValue(null);
    const res = await patch({ goalId: "ghost" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("allows a goalId in the SAME org and passes it through to updateInitiative", async () => {
    mockGoalOrg.mockResolvedValue("acme");
    const res = await patch({ goalId: "goal_ok" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ goalId: "goal_ok" });
  });

  it("unlinking (goalId: null) needs no ownership lookup and is allowed", async () => {
    const res = await patch({ goalId: null });
    expect(res.status).toBe(200);
    expect(mockGoalOrg).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ goalId: null });
  });
});

describe("PATCH — targetDate must be YYYY-MM-DD (goals-initiatives #5)", () => {
  it("rejects a full datetime (accepted before) with 400", async () => {
    const res = await patch({ targetDate: "2026-07-13T10:00:00Z" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("accepts a bare calendar day", async () => {
    const res = await patch({ targetDate: "2026-07-13" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a nonsense date", async () => {
    const res = await patch({ targetDate: "2026-13-45" });
    expect(res.status).toBe(400);
  });
});
