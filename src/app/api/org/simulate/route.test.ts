// Route-integration test for POST /api/org/simulate — pins the documented NaN-target no-op
// regression guard (docs/harness/test-mastery-2026-06-18/investment-simulator-forecast.md
// MEDIUM #4, against ["src/app/api/org/simulate/route.ts"]:54 fix-validation + :37 rank fallback).
//
// THE BUG THIS PINS: `typeof NaN === "number"` is true, so an earlier version let `target: NaN`
// through; clamp(Math.round(NaN)) = NaN then made `cur < NaN` false for every repo and the route
// returned a silent 200 with before === after — a confidently-rendered "nothing changes"
// projection. The fix is the `Number.isFinite(t) && 0 <= t <= 100` guard.
//
// INVARIANTS PINNED (behavioral, via the real handler):
//   1. A non-finite (NaN / Infinity / -Infinity) OR out-of-range (<0 / >100) target — in single,
//      fixes[], or implicit-leg form — returns 400 and NEVER runs the simulation
//      (simulateOrgFixes is not called) → no garbage/NaN projection can be produced.
//   2. A bad dimId (non-D1..D9) returns 400 with no simulation.
//   3. A valid in-range target runs simulateOrgFixes and returns a 200 projection.
//   4. Rank mode silently falls back to target=70 for a non-finite / out-of-range target
//      (so rankOrgInvestments is called with 70, never NaN).
//
// The authz + db boundaries are mocked so we can assert EXACTLY whether/when the sim fires.
// Mirrors the in-house route-integration pattern in src/app/api/org/export/route.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  simulateOrgFixes: vi.fn(),
  rankOrgInvestments: vi.fn(),
  goalImpactsForScenario: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { POST } from "./route";
import { isDbConfigured, simulateOrgFixes, rankOrgInvestments, goalImpactsForScenario } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockSimulateOrgFixes = vi.mocked(simulateOrgFixes);
const mockRankOrgInvestments = vi.mocked(rankOrgInvestments);
const mockGoalImpactsForScenario = vi.mocked(goalImpactsForScenario);
const mockRequireOrgRead = vi.mocked(requireOrgRead);

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/org/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

// A minimal FleetProjection-shaped result; the route only reads `.before`/`.after` (for goal impacts)
// and otherwise echoes it. The before/after halves carry the axis averages goalImpactsForScenario wants.
const PROJECTION = {
  before: { avgOverall: 40, avgAdoption: 40, avgRigor: 40, postureCounts: {} },
  after: { avgOverall: 60, avgAdoption: 60, avgRigor: 60, postureCounts: {} },
  promotions: 1,
  affected: 1,
} as unknown as Awaited<ReturnType<typeof simulateOrgFixes>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgRead.mockResolvedValue(null); // authorized by default
  mockSimulateOrgFixes.mockResolvedValue(PROJECTION);
  mockRankOrgInvestments.mockResolvedValue([{ dimId: "D1", gain: 5 }] as never);
  mockGoalImpactsForScenario.mockResolvedValue([]);
});

// ===========================================================================
// 1. The documented NaN / out-of-range no-op regression — single-leg and fixes[] forms.
describe("POST /api/org/simulate — rejects a non-finite / out-of-range target (no silent no-op)", () => {
  // Each of these MUST yield a 400, never a 200 projection, and the sim must never run.
  const BAD_TARGETS: ReadonlyArray<[unknown, string]> = [
    [Number.NaN, "NaN (the documented bug: typeof NaN === 'number')"],
    [Number.POSITIVE_INFINITY, "+Infinity"],
    [Number.NEGATIVE_INFINITY, "-Infinity"],
    [-1, "below range (negative)"],
    [101, "above range (>100)"],
    ["70", "wrong type (string)"],
    [null, "null"],
    [undefined, "missing target"],
  ];

  for (const [target, why] of BAD_TARGETS) {
    it(`single { dimId, target } → 400 for ${why}, and NEVER simulates`, async () => {
      const res = await post({ org: "acme", dimId: "D2", target });

      expect(res.status).toBe(400);
      // The non-negotiable invariant: a malformed target cannot reach the projector, so it can
      // never produce a garbage/NaN "before === after" 200.
      expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
      expect(mockGoalImpactsForScenario).not.toHaveBeenCalled();
    });

    it(`fixes[] leg → 400 for ${why}, and NEVER simulates`, async () => {
      const res = await post({ org: "acme", fixes: [{ dimId: "D2", target }] });

      expect(res.status).toBe(400);
      expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
    });
  }

  it("rejects when ANY leg in a multi-fix scenario is non-finite (one bad NaN poisons the batch)", async () => {
    const res = await post({
      org: "acme",
      fixes: [
        { dimId: "D1", target: 80 }, // valid
        { dimId: "D2", target: Number.NaN }, // poison
      ],
    });

    expect(res.status).toBe(400);
    expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
  });

  it("rejects a bad dimId (non-D1..D9) with 400 and no simulation", async () => {
    for (const dimId of ["D0", "D10", "X1", "d2", "", "DROP"]) {
      mockSimulateOrgFixes.mockClear();
      const res = await post({ org: "acme", dimId, target: 70 });
      expect(res.status, `dimId=${JSON.stringify(dimId)}`).toBe(400);
      expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
    }
  });
});

// ===========================================================================
// 2. The valid path still simulates — the guard rejects only the bad input, not everything.
describe("POST /api/org/simulate — a valid in-range target simulates (200)", () => {
  it("runs simulateOrgFixes with the finite target and returns a 200 projection", async () => {
    const res = await post({ org: "acme", dimId: "D2", target: 70 });

    expect(res.status).toBe(200);
    expect(mockSimulateOrgFixes).toHaveBeenCalledTimes(1);
    // The leg reaches the projector with the exact finite target — no clamping to NaN.
    expect(mockSimulateOrgFixes).toHaveBeenCalledWith("acme", [{ dimId: "D2", target: 70 }], []);
    const body = await res.json();
    expect(body.projection).toBeTruthy();
    expect(body.projection.after.avgOverall).toBe(60);
  });

  it("accepts the range boundaries 0 and 100", async () => {
    for (const target of [0, 100]) {
      mockSimulateOrgFixes.mockClear();
      const res = await post({ org: "acme", dimId: "D1", target });
      expect(res.status, `target=${target}`).toBe(200);
      expect(mockSimulateOrgFixes).toHaveBeenCalledWith("acme", [{ dimId: "D1", target }], []);
    }
  });

  it("404s (not 200) when there are no scanned repos to simulate", async () => {
    mockSimulateOrgFixes.mockResolvedValue(null);
    const res = await post({ org: "acme", dimId: "D2", target: 70 });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 3. Rank mode falls back to 70 on a bad target (never passes NaN to the ranker).
describe("POST /api/org/simulate — rank mode target fallback (never NaN)", () => {
  const BAD: ReadonlyArray<[unknown, string]> = [
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [-1, "negative"],
    [101, ">100"],
    ["70", "string"],
    [undefined, "missing"],
  ];

  for (const [target, why] of BAD) {
    it(`falls back to target=70 for ${why}`, async () => {
      const res = await post({ org: "acme", rank: true, target });

      expect(res.status).toBe(200);
      expect(mockRankOrgInvestments).toHaveBeenCalledTimes(1);
      // The invariant: a bad target degrades to the documented 70 default, never a NaN rank.
      expect(mockRankOrgInvestments).toHaveBeenCalledWith("acme", 70, []);
    });
  }

  it("passes a VALID rank target through unchanged (the fallback is bad-input-only)", async () => {
    const res = await post({ org: "acme", rank: true, target: 85 });
    expect(res.status).toBe(200);
    expect(mockRankOrgInvestments).toHaveBeenCalledWith("acme", 85, []);
  });

  it("404s when there are no scanned repos to rank", async () => {
    mockRankOrgInvestments.mockResolvedValue(null);
    const res = await post({ org: "acme", rank: true, target: 70 });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 4. Pre-sim short-circuits — confirm no sim runs on these either (defense for the no-garbage rule).
describe("POST /api/org/simulate — pre-sim short-circuits", () => {
  it("503 when the DB is not configured (before authz, before sim)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await post({ org: "acme", dimId: "D2", target: 70 });
    expect(res.status).toBe(503);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
  });

  it("400 when org is missing", async () => {
    const res = await post({ dimId: "D2", target: 70 });
    expect(res.status).toBe(400);
    expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
  });

  it("returns the authz denial unchanged and never simulates", async () => {
    mockRequireOrgRead.mockResolvedValue(
      new Response(JSON.stringify({ error: "denied" }), { status: 403 }) as never,
    );
    const res = await post({ org: "victim", dimId: "D2", target: 70 });
    expect(res.status).toBe(403);
    expect(mockSimulateOrgFixes).not.toHaveBeenCalled();
  });
});
