// Playbook lift as a named-status before/after pair (playbooks-0, challenge-2026-10-22e). Registry:
// software-engineering / adoption-measurement, technique before-after-outcome-pairing: resolve the
// boundary toward AFTER, compare only what both sides scored, give every application a named status,
// and report the unpaired population beside the delta.

import { describe, expect, it } from "vitest";
import { foldLift, liftSampleNote, pair, type LiftReading } from "./playbookLiftModel";

const T = new Date("2026-02-10T00:00:00Z");
const day = 86_400_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const r = (when: Date, score: number | null, engineProvider: string | null = "anthropic"): LiftReading => ({ at: when, score, engineProvider });

describe("pair: the adoption boundary resolves toward 'after'", () => {
  it("a reading AT the adoption instant is after-side: 40 @ T-1d, 60 @ T, 70 @ T+5d -> before 40, after 70, +30", () => {
    const out = pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), 40), r(T, 60), r(at(T, 5 * day), 70)]);
    expect(out).toEqual({ status: "paired", before: 40, after: 70, delta: 30 });
  });

  it("a scan-stamped mark's landing scan (which already carries the playbook file) is after-side", () => {
    const L = new Date("2026-03-01T00:00:00Z");
    const app = { appliedAt: at(L, 2000), scanStamped: true };
    const out = pair(app, [r(at(L, -7 * day), 40), r(L, 65), r(at(L, 7 * day), 70)]);
    expect(out).toEqual({ status: "paired", before: 40, after: 70, delta: 30 });
  });

  it("guard: a human mark keeps appliedAt as its boundary (the landing-scan rule is only for scan stamps)", () => {
    const L = new Date("2026-03-01T00:00:00Z");
    const out = pair({ appliedAt: at(L, 2000), scanStamped: false }, [r(at(L, -7 * day), 40), r(L, 65), r(at(L, 7 * day), 70)]);
    expect(out).toMatchObject({ before: 65, after: 70, delta: 5 });
  });

  it("the readings may arrive in any order", () => {
    const out = pair({ appliedAt: T, scanStamped: false }, [r(at(T, 5 * day), 70), r(at(T, -day), 40), r(at(T, -9 * day), 10)]);
    expect(out).toMatchObject({ before: 40, after: 70 });
  });
});

describe("pair: every application gets a named status", () => {
  it("the latest reading is a mock scan -> 'mock-reading' (never swapped for an older live scan)", () => {
    const out = pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), 40), r(at(T, day), 75), r(at(T, 2 * day), 0, "mock")]);
    expect(out).toEqual({ status: "mock-reading", before: null, after: null, delta: null });
  });

  it("a mock pre-adoption reading is 'mock-reading', not replaced by the older live scan", () => {
    const out = pair({ appliedAt: T, scanStamped: false }, [r(at(T, -5 * day), 30), r(at(T, -day), 0, "mock"), r(at(T, day), 70)]);
    expect(out.status).toBe("mock-reading");
  });

  it("no reading before the boundary -> 'no-before'; a single scan exactly at appliedAt is that case", () => {
    expect(pair({ appliedAt: T, scanStamped: false }, [r(T, 50)]).status).toBe("no-before");
    expect(pair({ appliedAt: T, scanStamped: false }, []).status).toBe("no-before");
  });

  it("no reading after the boundary -> 'no-after'", () => {
    expect(pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), 80)]).status).toBe("no-after");
  });

  it("the playbook's dimension absent on one side -> 'no-dimension'", () => {
    expect(pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), null), r(at(T, day), 70)]).status).toBe("no-dimension");
    expect(pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), 40), r(at(T, day), null)]).status).toBe("no-dimension");
  });

  it("a negative delta is reported, not floored (70 -> 40 = -30)", () => {
    expect(pair({ appliedAt: T, scanStamped: false }, [r(at(T, -day), 70), r(at(T, day), 40)])).toMatchObject({ delta: -30 });
  });
});

describe("foldLift: measured + sum(unpaired) = applications", () => {
  it("averages only the paired deltas (rounded) and counts every other status by name", () => {
    const out = foldLift([
      { status: "paired", before: 40, after: 70, delta: 30 },
      { status: "paired", before: 50, after: 70, delta: 20 },
      { status: "no-after", before: null, after: null, delta: null },
      { status: "no-before", before: null, after: null, delta: null },
      { status: "mock-reading", before: null, after: null, delta: null },
      { status: "no-dimension", before: null, after: null, delta: null },
    ]);
    expect(out).toEqual({ lift: 25, measured: 2, unpaired: { noBefore: 1, noAfter: 1, mock: 1, noDimension: 1 } });
    expect(out.measured + Object.values(out.unpaired).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it("nothing paired -> lift null (an unmeasurable application is never a 0 lift)", () => {
    const out = foldLift([{ status: "no-after", before: null, after: null, delta: null }]);
    expect(out.lift).toBeNull();
    expect(out.measured).toBe(0);
  });
});

describe("liftSampleNote: the sample beside the number", () => {
  it("names the measured share and every non-empty unpaired reason", () => {
    expect(liftSampleNote({ measured: 3, repos: 12, unpaired: { noAfter: 5, noBefore: 2, mock: 2, noDimension: 0 } })).toBe(
      "measured in 3 of 12 · 5 not re-scanned since · 2 adopted before their first scan · 2 mock scans excluded",
    );
  });

  it("singular forms, a no-dimension reason, and no unpaired at all", () => {
    expect(liftSampleNote({ measured: 1, repos: 2, unpaired: { noAfter: 0, noBefore: 0, mock: 1, noDimension: 1 } })).toBe(
      "measured in 1 of 2 · 1 mock scan excluded · 1 without the dimension scored",
    );
    expect(liftSampleNote({ measured: 2, repos: 2 })).toBe("measured in 2 of 2");
  });

  it("carries no em dash", () => {
    expect(liftSampleNote({ measured: 0, repos: 3, unpaired: { noAfter: 1, noBefore: 1, mock: 1, noDimension: 1 } })).not.toContain("\u2014");
  });
});
