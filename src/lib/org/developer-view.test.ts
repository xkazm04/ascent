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
