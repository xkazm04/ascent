// The rollout matrix's encodings, pinned without a DOM.
//
// The load-bearing assertion is the one the old strip could not make: a practice NO repository has
// been assessed for is `not-judged`, carries no score, and `rendersValue` refuses to print one — so
// "never looked" can never be rendered as "looked and found nothing".

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import {
  LABEL_MAX,
  ROLLOUT_AXES,
  ROLLOUT_HINT,
  rolloutMatrixRows,
  rolloutScopeLine,
  rolloutVizStates,
  truncateLabel,
} from "./practiceRolloutViz";
import type { PracticeRow } from "./practiceRows";
import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";

function mined(over: Partial<OrgPractice> = {}): PracticeRow {
  const p: OrgPractice = {
    id: "ci-gates",
    label: "CI gates on merge",
    dimId: "D3",
    what: "what",
    starter: [],
    total: 10,
    strongCount: 5,
    exemplar: null,
    gapRepos: [],
    gapRepoRefs: [],
    ...over,
  };
  return {
    key: `mined:${p.id}`,
    source: "mined",
    id: p.id,
    label: p.label,
    dimId: p.dimId,
    what: p.what,
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    ...(p.prs ? { rollout: p.prs } : {}),
    mined: p,
  };
}

function authored(adoption?: Partial<PlaybookAdoption>): PracticeRow {
  const pb = { id: "pb1", title: "Review rota", dimId: "D6", summary: "s" } as unknown as PlaybookRow;
  return {
    key: `authored:${pb.id}`,
    source: "authored",
    id: pb.id,
    label: pb.title,
    dimId: pb.dimId,
    what: "s",
    adoptionPct: null,
    adoptionLabel: "",
    reachLabel: null,
    opportunity: 0,
    authored: {
      playbook: pb,
      ...(adoption ? { adoption: { repos: 0, appliedRepos: [], lift: null, measured: 0, ...adoption } } : {}),
    },
  };
}

const cellsOf = (row: PracticeRow, fleet = 20) => rolloutMatrixRows([row], fleet)[0]!.cells;

describe("rolloutMatrixRows — a never-assessed practice cannot print a number", () => {
  it("hatches BOTH Assessed and Adopted when no repo has been scored", () => {
    const c = cellsOf(mined({ total: 0, strongCount: 0 }));
    expect(c[0]!.state).toBe("not-judged");
    expect(c[1]!.state).toBe("not-judged");
    expect(c[0]!.score).toBeUndefined();
    expect(c[1]!.score).toBeUndefined();
    // The invariant, not the caption: the kit refuses a value for this state.
    expect(rendersValue(c[0]!.state)).toBe(false);
    expect(rendersValue(c[1]!.state)).toBe(false);
  });

  it("distinguishes never-assessed from assessed-and-nobody-adopted", () => {
    const never = cellsOf(mined({ total: 0, strongCount: 0 }));
    const none = cellsOf(mined({ total: 10, strongCount: 0 }));
    expect(never[1]!.state).toBe("not-judged");
    expect(none[1]!).toEqual({ state: "measured", score: 0 });
  });

  it("scores Assessed as coverage of the fleet, not of itself", () => {
    expect(cellsOf(mined({ total: 5 }), 20)[0]).toEqual({ state: "measured", score: 25 });
    expect(cellsOf(mined({ total: 20 }), 20)[0]).toEqual({ state: "measured", score: 100 });
  });

  it("scores Adopted over the ASSESSED repos, the denominator the data actually has", () => {
    expect(cellsOf(mined({ total: 8, strongCount: 2 }), 40)[1]).toEqual({ state: "measured", score: 25 });
  });

  it("never lets a share exceed 100 or divide by zero", () => {
    expect(cellsOf(mined({ total: 7 }), 0)[0]).toEqual({ state: "measured", score: 100 });
    expect(cellsOf(mined({ total: 0, strongCount: 0 }), 0)[0]!.state).toBe("not-judged");
  });
});

describe("rolloutMatrixRows — Landed and Verified carry state, never a PR count on the maturity ramp", () => {
  it("voids Landed and Verified when the practice was never applied", () => {
    const c = cellsOf(mined());
    expect(c[2]).toEqual({ state: "missing" });
    expect(c[3]).toEqual({ state: "missing" });
  });

  it("marks in-flight-only as declared, and never as a landed zero", () => {
    const c = cellsOf(mined({ prs: { open: 3, merged: 0, lift: null } }));
    expect(c[2]).toEqual({ state: "declared" });
    expect(c[3]).toEqual({ state: "missing" });
  });

  it("hatches Verified while a merged PR awaits its post-merge rescan", () => {
    const c = cellsOf(mined({ prs: { open: 0, merged: 2, lift: null } }));
    expect(c[2]).toEqual({ state: "measured" });
    expect(c[3]).toEqual({ state: "not-judged" });
    expect(rendersValue(c[3]!.state)).toBe(false);
  });

  it("solidifies Verified once a lift was measured — including a measured zero lift", () => {
    expect(cellsOf(mined({ prs: { open: 0, merged: 2, lift: 0 } }))[3]).toEqual({ state: "measured" });
  });

  it("carries no score on either PR column", () => {
    const c = cellsOf(mined({ prs: { open: 1, merged: 4, lift: 6 } }));
    expect(c[2]!.score).toBeUndefined();
    expect(c[3]!.score).toBeUndefined();
  });
});

describe("rolloutMatrixRows — an authored standard is declared, never observed", () => {
  it("hatches Assessed for every authored playbook", () => {
    expect(cellsOf(authored({ repos: 4 }))[0]!.state).toBe("not-judged");
  });

  it("draws its adoption dashed, over the whole fleet", () => {
    expect(cellsOf(authored({ repos: 5 }), 20)[1]).toEqual({ state: "declared", score: 25 });
  });

  it("voids Landed — playbook applications bypass the PR lifecycle, so there is no measurement", () => {
    expect(cellsOf(authored({ repos: 5 }))[2]).toEqual({ state: "missing" });
  });

  it("hatches Verified when no repo was scanned on both sides, and voids it when none adopted", () => {
    expect(cellsOf(authored({ repos: 3, measured: 0 }))[3]).toEqual({ state: "not-judged" });
    expect(cellsOf(authored({ repos: 3, measured: 2 }))[3]).toEqual({ state: "measured" });
    expect(cellsOf(authored({ repos: 0 }))[3]).toEqual({ state: "missing" });
  });

  it("treats a playbook with no adoption record as zero declared applications", () => {
    expect(cellsOf(authored())[1]).toEqual({ state: "declared", score: 0 });
  });
});

describe("shape, labels and legend", () => {
  it("emits exactly one cell per axis", () => {
    for (const row of [mined(), authored({ repos: 1 })]) {
      expect(cellsOf(row)).toHaveLength(ROLLOUT_AXES.length);
    }
  });

  it("caps the rows and keeps the caller's order", () => {
    const rows = rolloutMatrixRows([authored({ repos: 1 }), mined(), mined({ id: "x" })], 10, 2);
    expect(rows.map((r) => r.id)).toEqual(["authored:pb1", "mined:ci-gates"]);
  });

  it("truncates a label that would run into the first cell", () => {
    expect(truncateLabel("CI")).toBe("CI");
    expect(truncateLabel("Agent guidance (CLAUDE.md / AGENTS.md)").length).toBeLessThanOrEqual(LABEL_MAX);
    expect(truncateLabel("Agent guidance (CLAUDE.md / AGENTS.md)").endsWith("…")).toBe(true);
  });

  it("reports only the states present, in kit order", () => {
    // Nothing here is measured: the mined practice was never assessed and the authored one is a
    // declaration, so a "Measured" legend row would teach an encoding this chart does not use.
    const rows = rolloutMatrixRows([mined({ total: 0, strongCount: 0 }), authored({ repos: 2 })], 10);
    expect(rolloutVizStates(rows)).toEqual(["declared", "not-judged", "missing"]);
    expect(rolloutVizStates(rolloutMatrixRows([mined()], 10))).toEqual(["measured", "missing"]);
    expect(
      rolloutVizStates(rolloutMatrixRows([mined({ prs: { open: 2, merged: 0, lift: null } })], 10)),
    ).toEqual(["measured", "declared", "missing"]);
  });

  it("states unit and window only, under 60 characters", () => {
    expect(rolloutScopeLine(8, 14, 41)).toBe("8 of 14 practices · 41 repos");
    expect(rolloutScopeLine(1, 1, 1)).toBe("1 practice · 1 repo");
    expect(rolloutScopeLine(8, 14, 41).length).toBeLessThanOrEqual(60);
  });

  it("has one demoted sentence per axis", () => {
    for (const a of ROLLOUT_AXES) expect(ROLLOUT_HINT[a].length).toBeGreaterThan(40);
  });
});
