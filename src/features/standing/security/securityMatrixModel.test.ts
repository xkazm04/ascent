// The battery → epistemic-state mapping. These assertions are the contract that a control which did
// not produce a grade can never be rendered as one that passed.

import { describe, it, expect } from "vitest";
import type { SecurityRegisterRow, SecurityRowCheck } from "@/lib/org/security";
import { rendersValue } from "@/components/org/viz";
import { CHECK_AXES, checkState, cellScore, checkTally, matrixRows, shortLabel, statesPresent } from "./securityMatrixModel";

function check(over: Partial<SecurityRowCheck> = {}): SecurityRowCheck {
  return { id: "branch-protection", name: "Branch protection", group: "posture", risk: "high", score: 8, detail: "", ...over };
}
function row(over: Partial<SecurityRegisterRow> = {}) {
  return { fullName: "acme/web", name: "web", measured: true, checks: [] as SecurityRowCheck[], ...over };
}

describe("checkState — one producer behaviour, one state", () => {
  it("a graded control is `measured`", () => {
    expect(checkState(check({ score: 0 }))).toBe("measured"); // a real 0 IS a measurement
    expect(checkState(check({ score: 10 }))).toBe("measured");
  });

  it("a null score is `not-judged` — the producer excluded it from the D9 denominator", () => {
    expect(checkState(check({ score: null }))).toBe("not-judged");
  });

  it("a control the battery never emitted is `missing`", () => {
    expect(checkState(undefined)).toBe("missing");
  });

  it("neither absence state may carry a value — this is the guard, not a convention", () => {
    expect(rendersValue(checkState(check({ score: null })))).toBe(false);
    expect(rendersValue(checkState(undefined))).toBe(false);
    expect(rendersValue(checkState(check({ score: 3 })))).toBe(true);
  });
});

describe("cellScore — 0–10 battery grades onto the 0–100 scale D9 and scoreHex speak", () => {
  it("scales a grade by ten and refuses a null one", () => {
    expect(cellScore(check({ score: 8 }))).toBe(80);
    expect(cellScore(check({ score: 0 }))).toBe(0);
    expect(cellScore(check({ score: null }))).toBeNull();
    expect(cellScore(undefined)).toBeNull();
  });
});

describe("matrixRows", () => {
  it("emits one cell per battery control, in battery order", () => {
    const [r] = matrixRows([row({ checks: [check()] })]);
    expect(r!.cells).toHaveLength(CHECK_AXES.length);
    expect(r!.cells[0]).toEqual({ state: "measured", score: 80 });
    expect(r!.cells[1]!.state).toBe("missing");
  });

  it("an UNMEASURED repo is all voids — the fail-closed 0 never reaches a cell", () => {
    const [r] = matrixRows([row({ measured: false, score: 0, checks: [check({ score: 9 })] })]);
    expect(r!.cells.every((c) => c.state === "missing")).toBe(true);
    expect(r!.cells.every((c) => c.score === null)).toBe(true);
  });

  it("truncates a long repo name so it cannot run under the grid", () => {
    expect(shortLabel("short")).toBe("short");
    expect(shortLabel("a-very-long-repository-name")).toHaveLength(16);
  });
});

describe("statesPresent — the Legend contract", () => {
  it("lists only the states in the data, in vocabulary order", () => {
    const rows = matrixRows([row({ checks: [check(), check({ id: "sast", score: null })] })]);
    expect(statesPresent(rows)).toEqual(["measured", "not-judged", "missing"]);
    expect(statesPresent([])).toEqual([]);
  });
});

describe("checkTally — the two counts a chip row could not show at once", () => {
  it("separates failing posture controls from ungraded ones", () => {
    const t = checkTally(
      row({
        checks: [
          check({ id: "sast", score: 0 }),
          check({ id: "sbom", score: 3 }),
          check({ id: "policy", score: 9 }),
          check({ id: "known-vulnerabilities", group: "exposure", score: 0 }), // exposure, not a posture gap
          check({ id: "signed-releases", score: null }),
          check({ id: "pinned-dependencies", score: null }),
        ],
      }),
    );
    expect(t).toEqual({ failing: 2, notJudged: 2, graded: 4 });
  });

  it("an unmeasured repo tallies nothing at all rather than zero failures", () => {
    expect(checkTally(row({ measured: false, checks: [check({ score: 0 })] }))).toEqual({ failing: 0, notJudged: 0, graded: 0 });
  });
});
