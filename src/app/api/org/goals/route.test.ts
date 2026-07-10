// Pins the planning-data tenant boundary (goals-initiatives 06-18 #3): the goals/initiatives
// mutating routes are the cross-tenant write gate. The per-row [id] gate must key authz on the
// goal/initiative's TRUE org (getGoalOrgSlug / getInitiativeOrgSlug) — never a body-supplied value —
// so a non-member cannot create/update/delete planning rows in another org (IDOR). Past the gate,
// body validation must reject a bad metric / target / date / status with a 400 and NO DB write, and
// a Prisma P2025 must surface as 404 (not 500). The authz + plan DB boundaries are mocked; handlers
// are imported from the production ./route and ./[id]/route / ../initiatives/[id]/route modules.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  // Real validator parity: overall | adoption | rigor | D1..D9 (the route trusts this).
  isGoalMetric: (m: string) => m === "overall" || m === "adoption" || m === "rigor" || /^D[1-9]$/.test(m),
  listGoals: vi.fn(async () => []),
  createGoal: vi.fn(async () => ({ id: "goal-new" })),
  getGoalOrgSlug: vi.fn(async () => "acme"),
  updateGoal: vi.fn(async () => {}),
  deleteGoal: vi.fn(async () => {}),
  getInitiativeOrgSlug: vi.fn(async () => "acme"),
  updateInitiative: vi.fn(async () => {}),
  createInitiative: vi.fn(async () => ({ id: "init-new" })),
  listInitiatives: vi.fn(async () => []),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireOrgRead: vi.fn(async () => null),
}));

import { POST } from "./route";
import { PATCH as GOAL_PATCH, DELETE as GOAL_DELETE } from "./[id]/route";
import { PATCH as INIT_PATCH } from "../initiatives/[id]/route";
import { POST as INIT_POST } from "../initiatives/route";
import { requireOrgAccess } from "@/lib/authz";
import {
  createGoal,
  getGoalOrgSlug,
  updateGoal,
  deleteGoal,
  getInitiativeOrgSlug,
  updateInitiative,
  createInitiative,
} from "@/lib/db";

const mockAccess = vi.mocked(requireOrgAccess);
const mockCreate = vi.mocked(createGoal);
const mockGoalOrg = vi.mocked(getGoalOrgSlug);
const mockUpdate = vi.mocked(updateGoal);
const mockDelete = vi.mocked(deleteGoal);
const mockInitOrg = vi.mocked(getInitiativeOrgSlug);
const mockInitUpdate = vi.mocked(updateInitiative);
const mockInitCreate = vi.mocked(createInitiative);

const FORBIDDEN = () => Response.json({ error: "You don't have access to this organization." }, { status: 403 });

function postGoals(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
function patchGoal(id: string, body: Record<string, unknown>) {
  return GOAL_PATCH(
    new Request(`http://localhost/api/org/goals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}
function deleteGoalReq(id: string) {
  return GOAL_DELETE(new Request(`http://localhost/api/org/goals/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}
function patchInitiative(id: string, body: Record<string, unknown>) {
  return INIT_PATCH(
    new Request(`http://localhost/api/org/initiatives/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}
function postInitiatives(body: Record<string, unknown>) {
  return INIT_POST(
    new Request("http://localhost/api/org/initiatives", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "goal-new" } as Awaited<ReturnType<typeof createGoal>>);
  mockGoalOrg.mockResolvedValue("acme");
  mockUpdate.mockResolvedValue(undefined as Awaited<ReturnType<typeof updateGoal>>);
  mockDelete.mockResolvedValue(undefined as Awaited<ReturnType<typeof deleteGoal>>);
  mockInitOrg.mockResolvedValue("acme");
  mockInitUpdate.mockResolvedValue(undefined as Awaited<ReturnType<typeof updateInitiative>>);
  mockInitCreate.mockResolvedValue({ id: "init-new" } as Awaited<ReturnType<typeof createInitiative>>);
});

describe("POST /api/org/goals — authz gate then validation", () => {
  it("denies a non-member create with no write (gate keys on body.org, returns its 403)", async () => {
    mockAccess.mockResolvedValue(FORBIDDEN());
    const res = await postGoals({ org: "victim", label: "x", metric: "overall", target: 80 });
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing required field with 400 before touching authz/db", async () => {
    const res = await postGoals({ org: "acme", label: "x", metric: "overall" }); // no target
    expect(res.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a bad metric with 400 AFTER the gate passes, DB untouched", async () => {
    const res = await postGoals({ org: "acme", label: "x", metric: "D10", target: 80 });
    expect(res.status).toBe(400);
    expect(mockAccess).toHaveBeenCalledWith("acme"); // gate ran first
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a non-ISO targetDate with 400, DB untouched", async () => {
    const res = await postGoals({ org: "acme", label: "x", metric: "overall", target: 80, targetDate: "nonsense" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates an in-org goal when authorized and valid", async () => {
    const res = await postGoals({ org: "acme", label: "reach L3", metric: "D2", target: 80, targetDate: "2026-12-01" });
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toBe("acme");
  });
});

describe("PATCH/DELETE /api/org/goals/:id — per-row tenant gate keys on the goal's true org", () => {
  it("DENIES a cross-tenant update with NO write: gate uses getGoalOrgSlug(id), not a body org", async () => {
    // The goal truly belongs to 'victim'; the attacker is not a member there.
    mockGoalOrg.mockResolvedValue("victim");
    mockAccess.mockImplementation(async (org) => (org === "victim" ? FORBIDDEN() : null));
    const res = await patchGoal("goal-1", { org: "acme", label: "pwned", target: 1 });
    expect(res.status).toBe(403);
    expect(mockGoalOrg).toHaveBeenCalledWith("goal-1");
    expect(mockAccess).toHaveBeenCalledWith("victim"); // authz keyed on TRUE org, ignored body.org
    expect(mockAccess).not.toHaveBeenCalledWith("acme");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("DENIES a cross-tenant delete with NO write", async () => {
    mockGoalOrg.mockResolvedValue("victim");
    mockAccess.mockImplementation(async (org) => (org === "victim" ? FORBIDDEN() : null));
    const res = await deleteGoalReq("goal-1");
    expect(res.status).toBe(403);
    expect(mockAccess).toHaveBeenCalledWith("victim");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404s when the goal does not exist, before any authz side effect", async () => {
    mockGoalOrg.mockResolvedValue(null);
    const res = await patchGoal("ghost", { label: "x" });
    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-ISO targetDate with 400 after the gate, DB untouched", async () => {
    const res = await patchGoal("goal-1", { targetDate: "nonsense" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps a Prisma P2025 to 404 (not 500) on update", async () => {
    mockUpdate.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));
    const res = await patchGoal("goal-1", { label: "x" });
    expect(res.status).toBe(404);
  });

  it("maps a Prisma P2025 to 404 (not 500) on delete", async () => {
    mockDelete.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));
    const res = await deleteGoalReq("goal-1");
    expect(res.status).toBe(404);
  });

  it("allows an authorized in-org update", async () => {
    const res = await patchGoal("goal-1", { label: "renamed", target: 90 });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toBe("goal-1");
  });
});

describe("PATCH /api/org/initiatives/:id — gate keys on the initiative's true org + status whitelist", () => {
  it("DENIES a cross-tenant update with NO write: authz uses getInitiativeOrgSlug(id)", async () => {
    mockInitOrg.mockResolvedValue("victim");
    mockAccess.mockImplementation(async (org) => (org === "victim" ? FORBIDDEN() : null));
    const res = await patchInitiative("init-1", { status: "done" });
    expect(res.status).toBe(403);
    expect(mockAccess).toHaveBeenCalledWith("victim");
    expect(mockInitUpdate).not.toHaveBeenCalled();
  });

  it("404s when the initiative does not exist, before authz", async () => {
    mockInitOrg.mockResolvedValue(null);
    const res = await patchInitiative("ghost", { status: "done" });
    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockInitUpdate).not.toHaveBeenCalled();
  });

  it("rejects a bogus status with 400 after the gate, DB untouched", async () => {
    const res = await patchInitiative("init-1", { status: "bogus" });
    expect(res.status).toBe(400);
    expect(mockInitUpdate).not.toHaveBeenCalled();
  });

  // Drift fix (goals-and-initiatives #1): the shared targetDate ISO check is now applied to
  // initiatives too — a bad value used to be silently coerced to null by parseTargetDate.
  it("rejects a non-ISO targetDate with 400 after the gate, DB untouched (drift fix)", async () => {
    const res = await patchInitiative("init-1", { targetDate: "nonsense" });
    expect(res.status).toBe(400);
    expect(mockInitUpdate).not.toHaveBeenCalled();
  });

  it("maps a Prisma P2025 to 404 (not 500)", async () => {
    mockInitUpdate.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));
    const res = await patchInitiative("init-1", { status: "done" });
    expect(res.status).toBe(404);
  });

  it("allows an authorized in-org status move", async () => {
    const res = await patchInitiative("init-1", { status: "in_progress" });
    expect(res.status).toBe(200);
    expect(mockInitUpdate).toHaveBeenCalledTimes(1);
    expect(mockInitUpdate.mock.calls[0][0]).toBe("init-1");
  });
});

describe("POST /api/org/initiatives — targetDate is now validated (drift fix)", () => {
  // Previously the initiatives create path skipped the targetDate ISO check the goals path enforced;
  // the Initiative.targetDate column is a DateTime, so a bad value was silently stored as null.
  it("rejects a non-ISO targetDate with 400 after the gate, DB untouched (drift fix)", async () => {
    const res = await postInitiatives({ org: "acme", title: "x", dimId: "D2", repos: [], targetDate: "nonsense" });
    expect(res.status).toBe(400);
    expect(mockAccess).toHaveBeenCalledWith("acme"); // gate ran first
    expect(mockInitCreate).not.toHaveBeenCalled();
  });

  it("creates with a valid ISO targetDate", async () => {
    const res = await postInitiatives({ org: "acme", title: "x", dimId: "D2", repos: [], targetDate: "2026-12-01" });
    expect(res.status).toBe(200);
    expect(mockInitCreate).toHaveBeenCalledTimes(1);
    expect(mockInitCreate.mock.calls[0][0]).toBe("acme");
  });
});
