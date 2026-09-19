// THE DIMENSION BAND — the sheet's third axis. What is pinned here is the arithmetic a collapsed band
// prints, because that arithmetic is the whole trade: the reader gives up the individual headlines and
// is owed, in exchange, a count they can compare across columns without opening anything.

import { describe, expect, it } from "vitest";
import { NO_DIM_KEY, groupCellCaption, groupSheetRows, isBand } from "./outcomeSheetGroups";
import type { SheetGapCell, SheetGapRow } from "./outcomeSheetModel";

const cell = (o: Partial<SheetGapCell> = {}): SheetGapCell => ({
  runId: "r1",
  laneId: "l1",
  cover: "rec-1",
  state: "proposed",
  kind: "noted",
  headline: "a gap",
  evidence: null,
  dimId: "D2",
  review: null,
  ...o,
});

const row = (key: string, dimId: string | null, cells: Record<string, SheetGapCell | null>): SheetGapRow => ({
  key,
  headline: key,
  dimId,
  kind: "noted",
  cells,
});

const COLUMNS = ["r1", "r2"];

describe("groupSheetRows", () => {
  it("bands a project's rows by dimension, in dimension order, with the dimension-less band last", () => {
    const groups = groupSheetRows(
      [
        row("g1", "D9", { r1: cell({ dimId: "D9" }), r2: null }),
        row("g2", null, { r1: null, r2: cell({ dimId: null }) }),
        row("g3", "D2", { r1: cell({ dimId: "D2" }), r2: null }),
        row("g4", "D9", { r1: null, r2: cell({ dimId: "D9" }) }),
      ],
      COLUMNS,
    );
    expect(groups.map((g) => g.key)).toEqual(["D2", "D9", NO_DIM_KEY]);
    expect(groups[1]!.label).toBe("D9 · Security");
    expect(groups[2]!.label).toBe("No dimension");
    expect(groups[1]!.rows.map((r) => r.key)).toEqual(["g1", "g4"]);
  });

  it("counts, per run column, only the band's rows THAT RUN touched — and states a blank as null", () => {
    const groups = groupSheetRows(
      [
        row("g1", "D9", { r1: cell({ state: "committed" }), r2: cell({ state: "proposed" }) }),
        row("g2", "D9", { r1: cell({ state: "uncommitted" }), r2: null }),
        row("g3", "D9", { r1: null, r2: null }),
      ],
      COLUMNS,
    );
    const band = groups[0]!;
    expect(band.rows).toHaveLength(3);
    // Run 1 touched two of the three; run 2 touched one. The untouched row is in NEITHER count —
    // "this run did nothing here" and "this gap exists" are different facts and the sheet keeps them so.
    expect(band.cells.r1).toMatchObject({ total: 2, byState: { committed: 1, uncommitted: 1, proposed: 0 } });
    expect(band.cells.r2).toMatchObject({ total: 1, byState: { committed: 0, uncommitted: 0, proposed: 1 } });
  });

  it("leaves a column the band is untouched in as null, never as a zero", () => {
    const groups = groupSheetRows([row("g1", "D5", { r1: cell(), r2: null })], COLUMNS);
    expect(groups[0]!.cells.r1).not.toBeNull();
    expect(groups[0]!.cells.r2).toBeNull();
  });

  it("counts the owner's standing rulings, so a finished band says so once instead of N times", () => {
    const groups = groupSheetRows(
      [
        row("g1", "D1", { r1: cell({ review: "approved" }), r2: null }),
        row("g2", "D1", { r1: cell({ review: "dismissed" }), r2: null }),
      ],
      COLUMNS,
    );
    expect(groups[0]!.cells.r1!.reviewed).toBe(2);
    expect(groups[0]!.cells.r1!.total).toBe(2);
  });
});

describe("isBand", () => {
  it("refuses to band ONE row — a header that collapses a single thing costs a row and saves none", () => {
    const [single, pair] = groupSheetRows(
      [row("g1", "D1", { r1: cell(), r2: null }), row("g2", "D2", { r1: cell(), r2: null }), row("g3", "D2", { r1: cell(), r2: null })],
      COLUMNS,
    );
    expect(isBand(single!)).toBe(false);
    expect(isBand(pair!)).toBe(true);
  });
});

describe("groupCellCaption", () => {
  it("names only the states present, in the order a reader cares about them", () => {
    expect(groupCellCaption({ total: 4, byState: { committed: 2, uncommitted: 1, proposed: 1 }, reviewed: 0 })).toBe(
      "2 done · 1 uncommitted · 1 open",
    );
    expect(groupCellCaption({ total: 2, byState: { committed: 0, uncommitted: 0, proposed: 2 }, reviewed: 0 })).toBe("2 open");
  });
});
