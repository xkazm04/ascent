// The pure half of the Developer read model. `developer-view.ts` was split away from its `-load.ts`
// sibling precisely so these four derivations could be exercised without a database — and then they
// never were. They are load-bearing: `careShapeValue` and `careBandVerdict` decide what a developer
// is told about themselves against an anonymous org band, and getting either subtly wrong ("above the
// median" when they are below it) is the kind of quiet lie this page exists to not tell.

import { describe, expect, it } from "vitest";
import {
  CARE_MOVE_STATES,
  careBandVerdict,
  careKeptSaving,
  careMovesByState,
  careShapeValue,
  emptyDeveloperView,
  emptyOrgView,
  careBandFromSharers,
  CARE_BAND_MIN_SHARERS,
  SHARING_LEDGER_OFF,
  type CareBand,
  type CareMove,
} from "./developer-view";

function move(over: Partial<CareMove> & Pick<CareMove, "id" | "state">): CareMove {
  return {
    title: `move ${over.id}`,
    category: "session",
    why: "journal line",
    evidence: null,
    expectedSaving: null,
    tryFor: null,
    at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("careMovesByState", () => {
  it("returns every state as a key, empty rather than absent", () => {
    const byState = careMovesByState([]);
    expect(Object.keys(byState).sort()).toEqual([...CARE_MOVE_STATES].sort());
    // The board renders a column per state and counts it; a missing key would be a crash, and a
    // filtered-out column would silently drop a state the developer chose.
    for (const state of CARE_MOVE_STATES) expect(byState[state]).toEqual([]);
  });

  it("buckets each move under its own state and keeps input order within a bucket", () => {
    const byState = careMovesByState([
      move({ id: "a", state: "kept" }),
      move({ id: "b", state: "proposed" }),
      move({ id: "c", state: "kept" }),
      move({ id: "d", state: "dropped" }),
    ]);
    expect(byState.kept.map((m) => m.id)).toEqual(["a", "c"]);
    expect(byState.proposed.map((m) => m.id)).toEqual(["b"]);
    expect(byState.dropped.map((m) => m.id)).toEqual(["d"]);
    expect(byState.trying).toEqual([]);
  });
});

describe("careKeptSaving", () => {
  it("is null when nothing is kept — no moves at all", () => {
    expect(careKeptSaving([])).toBeNull();
  });

  it("is null when kept moves exist but none is quantified — never 0", () => {
    // 0 would render as "0.0 h/wk back" in the masthead, which claims a measurement that was never
    // made. The honest answer is the absence of one.
    expect(careKeptSaving([move({ id: "a", state: "kept", expectedSaving: null })])).toBeNull();
  });

  it("sums only the kept, quantified moves", () => {
    expect(
      careKeptSaving([
        move({ id: "a", state: "kept", expectedSaving: 95 }),
        move({ id: "b", state: "kept", expectedSaving: 60 }),
        move({ id: "c", state: "kept", expectedSaving: null }),
        move({ id: "d", state: "trying", expectedSaving: 45 }),
        move({ id: "e", state: "dropped", expectedSaving: 30 }),
      ]),
    ).toBe(155);
  });

  it("counts a genuine zero saving as quantified", () => {
    expect(careKeptSaving([move({ id: "a", state: "kept", expectedSaving: 0 })])).toBe(0);
  });
});

describe("careShapeValue", () => {
  it("renders an em-dash for null and undefined, never a zero", () => {
    expect(careShapeValue("sessionsPerWeek", null)).toBe("—");
    expect(careShapeValue("sessionsPerWeek", undefined)).toBe("—");
  });

  it("suffixes the percent fields and rounds them", () => {
    expect(careShapeValue("planModePct", 62.4)).toBe("62%");
    expect(careShapeValue("testsBeforeCommitPct", 99.5)).toBe("100%");
  });

  it("leaves count fields as plain numbers", () => {
    expect(careShapeValue("sessionsPerWeek", 11)).toBe("11");
    expect(careShapeValue("turnsPerSession", 8.5)).toBe("8.5");
    expect(careShapeValue("skillInvokes30d", 0)).toBe("0");
  });
});

describe("careBandVerdict", () => {
  const band: CareBand = { p25: 10, p50: 20, p75: 30 };

  it("says nothing without a value or without a band — comparison is opt-in", () => {
    expect(careBandVerdict("planModePct", null, band)).toBeNull();
    expect(careBandVerdict("planModePct", 50, undefined)).toBeNull();
  });

  it("reads the top and bottom quartiles as praise where higher is better", () => {
    expect(careBandVerdict("planModePct", 30, band)).toBe("top quartile");
    expect(careBandVerdict("planModePct", 10, band)).toBe("bottom quartile");
  });

  it("reads the same quartiles neutrally where higher is NOT better", () => {
    // retriesPerSession: being high is not an achievement, so the wording must not congratulate.
    expect(careBandVerdict("retriesPerSession", 40, band)).toBe("above the org's upper quartile");
    expect(careBandVerdict("retriesPerSession", 5, band)).toBe("below the org's lower quartile");
  });

  it("places a mid-band value against the median, inclusive at the median itself", () => {
    expect(careBandVerdict("planModePct", 20, band)).toBe("above the median");
    expect(careBandVerdict("planModePct", 19, band)).toBe("below the median");
    expect(careBandVerdict("retriesPerSession", 25, band)).toBe("above the median");
  });

  it("prefers the quartile reading when the band is degenerate (all three equal)", () => {
    const flat: CareBand = { p25: 7, p50: 7, p75: 7 };
    expect(careBandVerdict("planModePct", 7, flat)).toBe("top quartile");
  });
});

describe("emptyDeveloperView", () => {
  it("carries the login and nothing else — every care field is empty, not zero-valued", () => {
    const v = emptyDeveloperView("octocat");
    expect(v.login).toBe("octocat");
    expect(v.activity).toBeNull();
    expect(v.profile).toEqual({ role: null, archetypeHint: null, goals: [], sharedAt: null });
    expect(v.moves).toEqual([]);
    expect(v.myRepos).toEqual([]);
    expect(v.journal).toEqual([]);
    expect(v.sharedFields).toEqual([]);
    expect(v.orgBands).toBeNull();
    expect(Object.values(v.shape).every((n) => n === null)).toBe(true);
  });

  it("defaults the login to null rather than inventing one", () => {
    expect(emptyDeveloperView().login).toBeNull();
  });

  it("is not stamped as a preview — only a fixture may carry `demo`", () => {
    expect(emptyDeveloperView("octocat").demo).toBeUndefined();
  });

  it("ships the privacy ledger with every line OFF, including the three permanent ones", () => {
    const v = emptyDeveloperView("octocat");
    expect(v.setup).toMatchObject({ mentorInstalled: false, hookInstalled: false, lastShareAt: null });
    expect(v.setup.sharing).toEqual(SHARING_LEDGER_OFF);
    expect(v.setup.sharing.every((r) => r.shared === false)).toBe(true);
    // The rows stated in the negative are the contract; silence about them would read as "maybe".
    const never = v.setup.sharing.filter((r) => r.note && /never|unrepresentable/i.test(r.note));
    expect(never.map((r) => r.field)).toEqual([
      "Transcript text",
      "Prompts, diffs, file contents",
      "Per-person rows in org mode",
    ]);
  });

  it("shares ONE ledger instance across views — the contract is a constant, not a per-view copy", () => {
    // Pinned deliberately: every empty view points at the same SHARING_LEDGER_OFF array, so a caller
    // that mutated it would change the privacy contract everywhere. Nothing mutates it today; this
    // records the aliasing so a future "just push a row" is caught here rather than in the UI.
    expect(emptyDeveloperView().setup.sharing).toBe(SHARING_LEDGER_OFF);
    expect(emptyDeveloperView("octocat").setup.sharing).toBe(emptyDeveloperView().setup.sharing);
  });
});

// T6 (study 2026-09-15): can a sharer who knows their own value read the others out of the band?
describe("T6 band recoverability: three sharers [10, 40, 90]", () => {
  const values = [10, 40, 90];
  const own = 10;
  // Linear interpolation between order statistics (type 7), the quartile C4 intends for shapeBands.
  const quartile = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    const h = (s.length - 1) * p;
    const lo = Math.floor(h);
    return s[lo] + (h - lo) * (s[Math.min(lo + 1, s.length - 1)] - s[lo]);
  };
  // With n = 3 visible (adoption.sharing), type 7 gives p50 = x2, p25 = (x1 + x2) / 2, p75 = (x2 + x3) / 2.
  const invert = (b: CareBand) => [2 * b.p25 - b.p50, b.p50, 2 * b.p75 - b.p50];
  const othersRecovered = (b: CareBand | null) => {
    if (!b) return [];
    const rest = [...values];
    rest.splice(rest.indexOf(own), 1);
    return invert(b).filter((v) => v !== own && rest.includes(v));
  };

  it("arm A: the population floor (3) shows the band, and both other values fall out exactly", () => {
    const org = emptyOrgView(values.length);
    const band: CareBand | null = org.belowFloor
      ? null
      : { p25: quartile(values, 0.25), p50: quartile(values, 0.5), p75: quartile(values, 0.75) };
    const recovered = othersRecovered(band);
    console.log(`[T6] arm A floor=population>=${org.floor} population=3 sharers=3 band=${JSON.stringify(band)} own=${own} recovered=${JSON.stringify(recovered)} exact=${recovered.length}/2`);
    expect(band).toEqual({ p25: 25, p50: 40, p75: 65 });
    expect(recovered).toEqual([40, 90]);
  });

  it("arm B: the sharer floor (5) suppresses the band with a typed reason, so nothing falls out", () => {
    const result = careBandFromSharers(values);
    const recovered = othersRecovered(result.band);
    const reason = result.band ? null : result.reason;
    console.log(`[T6] arm B floor=sharers>=${CARE_BAND_MIN_SHARERS} population=3 sharers=3 band=${JSON.stringify(result.band)} reason=${reason} own=${own} recovered=${JSON.stringify(recovered)} exact=${recovered.length}/2`);
    expect(result).toEqual({ band: null, reason: "below-sharer-floor" });
    expect(recovered).toEqual([]);
  });

  it("keys the floor on sharers: 4 suppress, 5 compute the same quartiles arm A used, 0 is its own reason", () => {
    expect(careBandFromSharers([1, 2, 3, 4])).toEqual({ band: null, reason: "below-sharer-floor" });
    expect(careBandFromSharers([])).toEqual({ band: null, reason: "no-sharers" });
    const five = [90, 10, 40, 70, 20];
    expect(careBandFromSharers(five)).toEqual({ band: { p25: quartile(five, 0.25), p50: quartile(five, 0.5), p75: quartile(five, 0.75) } });
    // At the floor the quartiles ARE the 2nd, 3rd and 4th values; the extremes are never shown.
    expect(careBandFromSharers(five)).toEqual({ band: { p25: 20, p50: 40, p75: 70 } });
  });
});
