// The fleet-evolution timetable aligns each repo's own scan history onto a shared day-grid; these
// lock the alignment (day-bucketing, most-recent-N columns, latest-per-day), the per-repo evolution
// delta, and the fleet-average footer.

import { describe, expect, it } from "vitest";
import { buildFleetTimetable, columnAverages, shortDate } from "./fleetTimetable";
import type { OrgRepoHistory } from "@/lib/db/org-rollup";

const pt = (at: string, overall: number) => ({ at, overall, level: "L3", posture: "manual", headSha: null, engine: "mock" });
const repo = (name: string, points: { at: string; overall: number }[]): OrgRepoHistory => ({
  fullName: `acme/${name}`,
  owner: "acme",
  name,
  points: points.map((p) => pt(p.at, p.overall)),
});

describe("shortDate", () => {
  it("formats a day key as 'Mon D'", () => {
    expect(shortDate("2026-07-04")).toBe("Jul 4");
    expect(shortDate("2026-01-31")).toBe("Jan 31");
  });
  it("falls back to the raw key on malformed input", () => {
    expect(shortDate("nonsense")).toBe("nonsense");
  });
});

describe("buildFleetTimetable", () => {
  it("aligns repos onto shared day-columns; a missing day is null, not a shifted cell", () => {
    const t = buildFleetTimetable([
      repo("a", [{ at: "2026-06-01T10:00:00Z", overall: 50 }, { at: "2026-06-08T10:00:00Z", overall: 60 }]),
      repo("b", [{ at: "2026-06-08T10:00:00Z", overall: 70 }]), // no Jun 1 scan
    ]);
    expect(t.columns.map((c) => c.key)).toEqual(["2026-06-01", "2026-06-08"]);
    const a = t.rows.find((r) => r.name === "a")!;
    const b = t.rows.find((r) => r.name === "b")!;
    expect(a.cells).toEqual([50, 60]);
    expect(b.cells).toEqual([null, 70]); // b's Jun 8 lands in the Jun 8 column, not the first
  });

  it("keeps only the most recent maxCols day-columns", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"];
    const t = buildFleetTimetable([repo("a", days.map((d, i) => ({ at: `${d}T10:00:00Z`, overall: 40 + i })))], 2);
    expect(t.columns.map((c) => c.key)).toEqual(["2026-06-03", "2026-06-04"]);
    expect(t.rows[0]!.cells).toEqual([42, 43]);
  });

  it("collapses multiple same-day scans to the latest that day", () => {
    const t = buildFleetTimetable([
      repo("a", [
        { at: "2026-06-01T08:00:00Z", overall: 50 },
        { at: "2026-06-01T20:00:00Z", overall: 55 }, // later same day wins
      ]),
    ]);
    expect(t.columns).toHaveLength(1);
    expect(t.rows[0]!.cells).toEqual([55]);
  });

  it("computes per-cell run-over-run deltas (efficiency differentiator), null for the first reading", () => {
    const t = buildFleetTimetable([
      repo("a", [
        { at: "2026-06-01T10:00:00Z", overall: 50 },
        { at: "2026-06-08T10:00:00Z", overall: 55 },
        { at: "2026-06-15T10:00:00Z", overall: 53 },
      ]),
    ]);
    expect(t.rows[0]!.cellDeltas).toEqual([null, 5, -2]);
  });

  it("skips null cells for the per-cell delta baseline (diffs against the last real reading)", () => {
    const t = buildFleetTimetable([
      repo("a", [{ at: "2026-06-01T10:00:00Z", overall: 50 }]),
      repo("b", [{ at: "2026-06-08T10:00:00Z", overall: 70 }, { at: "2026-06-15T10:00:00Z", overall: 74 }]),
    ]);
    // a: only Jun 1 → [null(Jun1), null(Jun8 empty), null(Jun15 empty)]
    // b: Jun 1 empty, Jun 8 = 70 (first, null delta), Jun 15 = 74 (+4)
    const a = t.rows.find((r) => r.name === "a")!;
    const b = t.rows.find((r) => r.name === "b")!;
    expect(a.cellDeltas).toEqual([null, null, null]);
    expect(b.cellDeltas).toEqual([null, null, 4]);
  });

  it("computes evolution delta = latest − first over the shown window", () => {
    const t = buildFleetTimetable([repo("a", [{ at: "2026-06-01T10:00:00Z", overall: 48 }, { at: "2026-06-08T10:00:00Z", overall: 63 }])]);
    const a = t.rows[0]!;
    expect(a.first).toBe(48);
    expect(a.latest).toBe(63);
    expect(a.delta).toBe(15);
  });

  it("sorts rows by current standing (latest desc), strongest first", () => {
    const t = buildFleetTimetable([
      repo("weak", [{ at: "2026-06-08T10:00:00Z", overall: 40 }]),
      repo("strong", [{ at: "2026-06-08T10:00:00Z", overall: 80 }]),
    ]);
    expect(t.rows.map((r) => r.name)).toEqual(["strong", "weak"]);
  });

  it("null delta with a single reading (no evolution to show)", () => {
    const t = buildFleetTimetable([repo("a", [{ at: "2026-06-08T10:00:00Z", overall: 55 }])]);
    expect(t.rows[0]!.delta).toBeNull();
  });
});

describe("columnAverages", () => {
  it("averages each column over non-null cells", () => {
    const t = buildFleetTimetable([
      repo("a", [{ at: "2026-06-01T10:00:00Z", overall: 40 }, { at: "2026-06-08T10:00:00Z", overall: 60 }]),
      repo("b", [{ at: "2026-06-08T10:00:00Z", overall: 80 }]),
    ]);
    // Jun 1: only a (40). Jun 8: a=60,b=80 → 70.
    expect(columnAverages(t)).toEqual([40, 70]);
  });
});
