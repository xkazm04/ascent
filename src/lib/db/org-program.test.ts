import { describe, expect, it } from "vitest";
import {
  buildProgramStatus,
  parseBaseline,
  reposAtTarget,
  toProgramRow,
  type TransitionProgramRow,
} from "./org-program";

const program = (over: Partial<TransitionProgramRow> = {}): TransitionProgramRow => ({
  id: "p1",
  name: "Agent-ready by Q1",
  targetLevel: "L4",
  targetDate: null,
  cadence: "weekly",
  baselineAt: "2026-07-01T00:00:00Z",
  baseline: { overall: 48, adoption: 40, rigor: 52, scannedCount: 11, repoCount: 14 },
  status: "active",
  startedBy: "kp",
  ...over,
});

const live = (over: Partial<Parameters<typeof buildProgramStatus>[1]> = {}) => ({
  overall: 58,
  scannedCount: 11,
  atTarget: 4,
  inFlightPrs: 2,
  pointsBought: 17,
  ...over,
});

const NOW = new Date("2026-08-14T00:00:00Z"); // 44 days after the baseline → week 7

describe("reposAtTarget", () => {
  // "At target" means REACHING the rung, not landing on it — otherwise a fleet would appear to
  // regress as its best repos overshot the goal.
  it("counts repos at or above the target rung", () => {
    expect(reposAtTarget({ L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 }, "L4")).toBe(9);
    expect(reposAtTarget({ L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 }, "L1")).toBe(15);
    expect(reposAtTarget({ L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 }, "L5")).toBe(5);
  });

  it("is zero-safe for missing rungs and an unknown target", () => {
    expect(reposAtTarget({}, "L4")).toBe(0);
    expect(reposAtTarget({ L5: 3 }, "nope" as never)).toBe(0);
  });
});

describe("parseBaseline", () => {
  it("round-trips a stored snapshot", () => {
    const b = { overall: 48, adoption: 40, rigor: 52, scannedCount: 11, repoCount: 14 };
    expect(parseBaseline(JSON.stringify(b))).toEqual(b);
  });

  // A malformed blob must degrade to "no baseline" — the strip then omits movement rather than
  // throwing inside a layout that wraps every org tab.
  it("degrades to null on absent or malformed json instead of throwing", () => {
    expect(parseBaseline(null)).toBeNull();
    expect(parseBaseline("not json")).toBeNull();
    expect(parseBaseline('"a string"')).toBeNull();
  });

  it("nulls non-finite score fields rather than carrying NaN into arithmetic", () => {
    expect(parseBaseline('{"overall":"48","scannedCount":11}')).toEqual({
      overall: null,
      adoption: null,
      rigor: null,
      scannedCount: 11,
      repoCount: 0,
    });
  });
});

describe("toProgramRow", () => {
  const raw = {
    id: "p1",
    name: "P",
    targetLevel: "L3",
    targetDate: new Date("2026-12-01T00:00:00Z"),
    cadence: "monthly",
    baselineAt: new Date("2026-07-01T00:00:00Z"),
    baselineJson: null,
    status: "paused",
    startedBy: null,
  };

  it("maps a db row to the typed programme", () => {
    expect(toProgramRow(raw)).toMatchObject({ targetLevel: "L3", cadence: "monthly", status: "paused" });
  });

  // Unknown enum values must degrade, not throw: this row is read inside the shell layout, and a
  // hand-edited or future-version value must never blank every org tab.
  it("degrades unknown enum values to the defaults", () => {
    const r = toProgramRow({ ...raw, targetLevel: "L9", cadence: "hourly", status: "cancelled" });
    expect(r).toMatchObject({ targetLevel: "L4", cadence: "weekly", status: "active" });
  });
});

describe("buildProgramStatus", () => {
  it("counts weeks from the baseline, 1-based", () => {
    // Week 1 is the week it started — "Week 0 of your programme" reads as an error, not a start.
    expect(buildProgramStatus(program(), live(), new Date("2026-07-01T00:00:00Z")).week).toBe(1);
    expect(buildProgramStatus(program(), live(), new Date("2026-07-07T23:00:00Z")).week).toBe(1);
    expect(buildProgramStatus(program(), live(), new Date("2026-07-08T00:00:00Z")).week).toBe(2);
    expect(buildProgramStatus(program(), live(), NOW).week).toBe(7);
  });

  it("measures movement against the FROZEN baseline, not today's data", () => {
    const s = buildProgramStatus(program(), live({ overall: 58 }), NOW);
    expect(s.movedOverall).toBe(10); // 58 now vs 48 frozen at start
    expect(s.levelNow).toBe("L3");
    expect(s.levelTarget).toBe("L4");
  });

  it("reports a regression against the baseline rather than clamping at zero", () => {
    expect(buildProgramStatus(program(), live({ overall: 41 }), NOW).movedOverall).toBe(-7);
  });

  // An org that started a programme before its first scan has an honest ABSENT origin. Movement is
  // unknowable, and must read as unknown rather than as "+58 since zero".
  it("leaves movement null when there is no baseline to measure from", () => {
    expect(buildProgramStatus(program({ baseline: null }), live(), NOW).movedOverall).toBeNull();
  });

  it("leaves movement and level null when nothing is scanned yet", () => {
    const s = buildProgramStatus(program(), live({ overall: null, scannedCount: 0 }), NOW);
    expect(s.movedOverall).toBeNull();
    expect(s.levelNow).toBeNull();
  });

  // The W1d gate applied to the strip: a "bought" claim needs the Impact Ledger to back it.
  it("carries a null points-bought through as null, never as zero", () => {
    expect(buildProgramStatus(program(), live({ pointsBought: null }), NOW).pointsBought).toBeNull();
    expect(buildProgramStatus(program(), live({ pointsBought: 0 }), NOW).pointsBought).toBe(0);
  });

  it("paces the next review off the cadence", () => {
    expect(buildProgramStatus(program({ cadence: "weekly" }), live(), NOW).daysToReview).toBe(5); // 44 % 7 = 2
    expect(buildProgramStatus(program({ cadence: "biweekly" }), live(), NOW).daysToReview).toBe(12); // 44 % 14 = 2
    expect(buildProgramStatus(program({ cadence: "monthly" }), live(), NOW).daysToReview).toBe(12); // 44 % 28 = 16
  });

  // Printing "next review in 3 days" for a finished programme invites a meeting about a closed thing.
  it("has no next review once the programme is not active", () => {
    expect(buildProgramStatus(program({ status: "achieved" }), live(), NOW).daysToReview).toBeNull();
    expect(buildProgramStatus(program({ status: "paused" }), live(), NOW).daysToReview).toBeNull();
  });

  it("counts down to the target date and goes negative when overdue", () => {
    expect(buildProgramStatus(program({ targetDate: "2026-09-13T00:00:00Z" }), live(), NOW).daysToTarget).toBe(30);
    expect(buildProgramStatus(program({ targetDate: "2026-08-04T00:00:00Z" }), live(), NOW).daysToTarget).toBe(-10);
  });

  it("omits the target countdown entirely for an open-ended programme", () => {
    expect(buildProgramStatus(program({ targetDate: null }), live(), NOW).daysToTarget).toBeNull();
  });

  it("never reports a negative week for a clock skewed before the baseline", () => {
    expect(buildProgramStatus(program(), live(), new Date("2026-06-01T00:00:00Z")).week).toBe(1);
  });
});
