// The pure producer of the org care aggregate (C4, challenge 2026-10-22d developer-0). Suppression is
// enforced HERE, never at the surface: a population under the naming floor yields nothing, a field
// with fewer than five sharers yields a typed gap, and a kept move kept by fewer than five is dropped.

import { describe, expect, it } from "vitest";
import { buildCareOrgAggregate, CARE_KEPT_MOVE_MIN } from "./care-org-aggregate";
import { CARE_BAND_MIN_SHARERS, careBandFromSharers, type CareShapeField } from "./developer-view";
import type { CareSharePayload, CareShareMove } from "./care-share-contract";
import { CHAMPION_MIN_POP } from "./champions";

const LOGINS = ["ada-lovelace", "bob-builder", "cy-twombly", "dee-dee", "eve-online", "fay-wray"];

function share(fields: Partial<Record<CareShapeField, number>>, moves: CareShareMove[] = []): CareSharePayload {
  return {
    contract: 1,
    consent: { orgAggregate: true },
    moves,
    shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields },
  };
}

const kept = (title: string, extra: Partial<CareShareMove> = {}): CareShareMove => ({
  id: "m1", title, state: "kept", category: "session", why: "why", expectedSaving: null, tryFor: null, at: "2026-10-01T00:00:00.000Z", ...extra,
});

describe("buildCareOrgAggregate: the population floor suppresses, it does not thin", () => {
  it("population under CHAMPION_MIN_POP yields an empty aggregate however many shared", () => {
    const population = CHAMPION_MIN_POP - 1;
    const cohort = { shares: [10, 20, 30, 40, 50, 60].map((v) => share({ planModePct: v }, [kept("Plan first")])) };
    const agg = buildCareOrgAggregate(population, cohort);
    expect(agg.belowFloor).toBe(true);
    expect(agg.shapeBands).toEqual({});
    expect(agg.bandGaps).toEqual({});
    expect(agg.topKeptMoves).toEqual([]);
    expect(agg.adoption).toEqual({ setUp: 0, sharing: 0 });
  });
});

describe("buildCareOrgAggregate: per-field sharer floor", () => {
  it("bands a field five sharers sent, and names the gap for one four sent", () => {
    const shares = [10, 20, 30, 40, 50].map((v, i) => share(i < 4 ? { planModePct: v, testsBeforeCommitPct: v } : { planModePct: v }));
    const agg = buildCareOrgAggregate(12, { shares });
    const expected = careBandFromSharers([10, 20, 30, 40, 50]);
    expect(expected.band).not.toBeNull();
    expect(agg.shapeBands.planModePct).toEqual(expected.band);
    expect(agg.bandGaps.testsBeforeCommitPct).toBe("below-sharer-floor");
    expect(agg.shapeBands).not.toHaveProperty("testsBeforeCommitPct");
    expect(agg.bandGaps).not.toHaveProperty("sessionsPerWeek");
    expect(agg.adoption).toEqual({ setUp: 5, sharing: 5 });
  });

  it("a field shared as a declared reason (no number) is not a sharer of a value", () => {
    const shares = [1, 2, 3, 4].map((v) => share({ turnsPerSession: v }));
    const base = share({});
    const withReason: CareSharePayload = { ...base, shape: { ...base.shape!, fields: { turnsPerSession: { reason: "below-sample" } } } };
    const agg = buildCareOrgAggregate(12, { shares: [...shares, withReason] });
    expect(agg.bandGaps.turnsPerSession).toBe("below-sharer-floor");
    expect(agg.adoption).toEqual({ setUp: 5, sharing: 4 });
  });
});

describe("buildCareOrgAggregate: kept-move titles are k-floored", () => {
  it("a title kept by four is absent; kept by five it is present with keptBy 5; no login anywhere", () => {
    expect(CARE_KEPT_MOVE_MIN).toBe(CARE_BAND_MIN_SHARERS);
    const four = Array.from({ length: 4 }, () => share({}, [kept("Allowlist six commands", { category: "tooling" })]));
    const five = Array.from({ length: 5 }, (_, i) => share({}, [kept(i === 0 ? "  plan MODE   first " : "Plan mode first", { registryPromotable: i < 3 })]));
    const agg = buildCareOrgAggregate(12, { shares: [...four, ...five] });
    expect(agg.topKeptMoves).toEqual([{ title: "Plan mode first", keptBy: 5, category: "session", promotable: true }]);
    const out = JSON.stringify(agg);
    for (const login of LOGINS) expect(out).not.toContain(login);
    expect(out).not.toContain("Allowlist");
    expect(agg.asks).toEqual([]);
    expect(agg.outcomes).toEqual([]);
  });

  it("one sharer keeping the same title twice counts once, and a dropped move is not kept", () => {
    const twice = share({}, [kept("Plan mode first"), kept("plan mode first", { id: "m2" })]);
    const dropped = Array.from({ length: 4 }, () => share({}, [kept("Plan mode first", { state: "dropped" })]));
    const three = Array.from({ length: 3 }, () => share({}, [kept("Plan mode first")]));
    const agg = buildCareOrgAggregate(12, { shares: [twice, ...dropped, ...three] });
    expect(agg.topKeptMoves).toEqual([]);
  });
});
