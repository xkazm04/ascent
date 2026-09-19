// What the renderer is allowed to believe about a row that came out of a TEXT column.
//
// Every assertion here is about the SAME failure: `meta` is decoded JSON, so a block in it may have
// been written by an older build, hand-edited, or shaped by a future field — and the drawer that was
// supposed to be helping must not white-screen on it.
//
// The cap assertions deliberately reference the EXPORTED constants rather than the numbers 4/8/2. A
// test that hardcodes 4 passes forever after someone raises the validator's cap to 5 and forgets the
// renderer, which is precisely the drift `blocks.ts` exports them to prevent.

import { describe, it, expect } from "vitest";
import {
  ATHENA_CHART_MAX_POINTS,
  ATHENA_CHART_MAX_SERIES,
  ATHENA_MAX_BLOCKS,
  ATHENA_TABLE_MAX_COLUMNS,
  ATHENA_TABLE_MAX_ROWS,
} from "@/lib/athena/blocks";
import { ATHENA_VIEW_MAX_CHIPS, turnBlocks, turnChips, turnIsEphemeral } from "./model";

const meta = (m: Record<string, unknown>) => ({ meta: m });
const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("turnBlocks — a block is drawn whole or not at all", () => {
  it("reads a well-formed table and chart", () => {
    const blocks = turnBlocks(
      meta({
        blocks: [
          { type: "table", title: "Fleet", columns: ["Repo", "Level"], rows: [["acme/api", "L3"]] },
          { type: "chart", chart: "line", labels: ["Apr", "May"], series: [{ name: "Avg", values: [54, 62] }] },
        ],
      }),
    );
    expect(blocks.map((b) => b.type)).toEqual(["table", "chart"]);
  });

  it("drops a ragged table rather than rendering a confident misalignment", () => {
    expect(
      turnBlocks(meta({ blocks: [{ type: "table", columns: ["A", "B"], rows: [["only-one"]] }] })),
    ).toEqual([]);
  });

  it("drops a chart whose series is shorter than its axis", () => {
    expect(
      turnBlocks(
        meta({ blocks: [{ type: "chart", labels: ["a", "b", "c"], series: [{ name: "s", values: [1, 2] }] }] }),
      ),
    ).toEqual([]);
  });

  it("drops non-numeric chart values", () => {
    expect(
      turnBlocks(meta({ blocks: [{ type: "chart", labels: ["a"], series: [{ name: "s", values: ["7"] }] }] })),
    ).toEqual([]);
  });

  it("survives every shape of garbage without throwing", () => {
    for (const junk of [null, undefined, {}, meta({}), meta({ blocks: "nope" }), meta({ blocks: [null, 7, "x"] })]) {
      expect(turnBlocks(junk as never)).toEqual([]);
    }
  });

  it("clips a table to the EXPORTED column and row caps", () => {
    const wide = seq(ATHENA_TABLE_MAX_COLUMNS + 2).map((i) => `c${i}`);
    const [block] = turnBlocks(
      meta({
        blocks: [
          {
            type: "table",
            columns: wide,
            rows: seq(ATHENA_TABLE_MAX_ROWS + 3).map(() => wide.map(() => "v")),
          },
        ],
      }),
    );
    expect(block?.type).toBe("table");
    if (block?.type !== "table") return;
    expect(block.columns).toHaveLength(ATHENA_TABLE_MAX_COLUMNS);
    expect(block.rows).toHaveLength(ATHENA_TABLE_MAX_ROWS);
    expect(block.rows.every((r) => r.length === ATHENA_TABLE_MAX_COLUMNS)).toBe(true);
  });

  it("clips a chart to the EXPORTED point and series caps", () => {
    const labels = seq(ATHENA_CHART_MAX_POINTS + 4).map((i) => `p${i}`);
    const [block] = turnBlocks(
      meta({
        blocks: [
          {
            type: "chart",
            labels,
            series: seq(ATHENA_CHART_MAX_SERIES + 2).map((i) => ({ name: `s${i}`, values: labels.map(() => 1) })),
          },
        ],
      }),
    );
    expect(block?.type).toBe("chart");
    if (block?.type !== "chart") return;
    expect(block.labels).toHaveLength(ATHENA_CHART_MAX_POINTS);
    expect(block.series).toHaveLength(ATHENA_CHART_MAX_SERIES);
    expect(block.series.every((s) => s.values.length === ATHENA_CHART_MAX_POINTS)).toBe(true);
  });

  it("stops at the per-reply block cap", () => {
    const one = { type: "table", columns: ["A"], rows: [["1"]] };
    expect(turnBlocks(meta({ blocks: seq(ATHENA_MAX_BLOCKS + 3).map(() => one) }))).toHaveLength(
      ATHENA_MAX_BLOCKS,
    );
  });

  it("defaults an absent chart kind to bar without inventing anything about the data", () => {
    const [block] = turnBlocks(meta({ blocks: [{ type: "chart", labels: ["a"], series: [{ name: "s", values: [1] }] }] }));
    expect(block?.type === "chart" && block.chart).toBe("bar");
  });
});

describe("turnChips — at most two, and never an empty one", () => {
  it("keeps at most the view cap", () => {
    const chips = turnChips(meta({ chips: seq(5).map((i) => ({ insight: `insight ${i}` })) }));
    expect(chips).toHaveLength(ATHENA_VIEW_MAX_CHIPS);
  });

  it("skips blanks and non-strings rather than rendering an empty row", () => {
    expect(turnChips(meta({ chips: [{ insight: "   " }, { insight: 7 }, { nope: "x" }] }))).toEqual([]);
  });

  it("returns nothing when the turn carried none — an empty strip beats an echo", () => {
    expect(turnChips(meta({}))).toEqual([]);
    expect(turnChips(null)).toEqual([]);
  });
});

describe("turnIsEphemeral", () => {
  it('reads the empty id as "persisted nowhere", and only that', () => {
    expect(turnIsEphemeral({ id: "" })).toBe(true);
    expect(turnIsEphemeral({ id: "local:1" })).toBe(false);
    expect(turnIsEphemeral({ id: "abc" })).toBe(false);
  });
});
