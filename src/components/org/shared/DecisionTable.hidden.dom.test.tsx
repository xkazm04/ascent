// @vitest-environment jsdom
//
// A selection that outlives a filter change. DecisionTable takes the shown rows AND the full set
// (`allRows`) so a triage batch can be gathered across filters: tick two rows under one filter,
// switch, tick three more, act on all five. That reach is the feature, and it is only honest when
// the count the user reads before firing names every record the action will receive, including the
// ones the current filter is hiding. These pin:
//   (a) the bar says how many selected rows the current filter hides, and nothing when none are;
//   (b) a per-action count says how many of ITS rows are hidden, because an action scoped by
//       `appliesTo` can receive a different share of the hidden rows than the bar's total;
//   (c) the hidden rows can be dropped without dropping the shown ones;
//   (d) the payload is unchanged: gathering across filters still works.

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DecisionTable, type DecisionAction } from "./DecisionTable";

interface Row {
  id: string;
  kind: "a" | "b";
}

const ALL: Row[] = [
  { id: "r1", kind: "a" },
  { id: "r2", kind: "a" },
  { id: "r3", kind: "b" },
  { id: "r4", kind: "a" },
  { id: "r5", kind: "b" },
  { id: "r6", kind: "b" },
];
const SHOWN = ALL.slice(0, 3); // the current filter hides r4, r5, r6

function setup(selected: Set<string>, rows: Row[] = SHOWN) {
  const received: Record<string, string[]> = {};
  const onSelectedChange = vi.fn();
  const act = (key: string, label: string, appliesTo?: (r: Row) => boolean): DecisionAction<Row> => ({
    key,
    label,
    busyLabel: `${label}...`,
    tone: "neutral",
    appliesTo,
    run: (picked) => {
      received[key] = picked.map((r) => r.id);
      return false; // keep the selection so every action can be read from one render
    },
  });
  const actions = [act("dismiss", "Dismiss"), act("resolve", "Resolve", (r) => r.kind === "a"), act("approve", "Approve", (r) => r.kind === "b")];
  render(
    <DecisionTable<Row>
      caption="Test ledger"
      rows={rows}
      allRows={ALL}
      rowId={(r) => r.id}
      rowLabel={(r) => r.id}
      columns={[{ key: "id", header: "Id", cell: (r) => r.id }]}
      selected={selected}
      onSelectedChange={onSelectedChange}
      actions={actions}
    />,
  );
  return { received, onSelectedChange };
}

const button = (verb: string) => screen.getByRole("button", { name: new RegExp(`^${verb} `) });

// The measurable: per action, hidden rows it will receive that the text on screen does not let the
// user count exactly. A per-action "(N hidden)" names them; the bar's total names them only for an
// action that receives the whole selection.
function undisclosedHidden(verb: string, hiddenReceived: number, pickedTotal: number): number {
  const label = button(verb).textContent ?? "";
  const own = /\((\d+) hidden\)/.exec(label);
  if (own && Number(own[1]) === hiddenReceived) return 0;
  const bar = /(\d+) hidden by the current filter/.exec(document.body.textContent ?? "");
  const n = Number(/ (\d+)/.exec(label)?.[1] ?? NaN);
  if (bar && n === pickedTotal && Number(bar[1]) === hiddenReceived) return 0;
  return hiddenReceived;
}

describe("DecisionTable: a selection the current filter partly hides", () => {
  it("names the hidden share on the bar and on every action it reaches", async () => {
    const { received } = setup(new Set(ALL.map((r) => r.id)));
    // One action at a time: the bar disables its buttons while an action is running.
    for (const v of ["Dismiss", "Resolve", "Approve"]) {
      await act(async () => {
        fireEvent.click(button(v));
      });
    }
    // (d) payloads: the gathered batch still reaches the hidden rows.
    expect(received).toEqual({ dismiss: ["r1", "r2", "r3", "r4", "r5", "r6"], resolve: ["r1", "r2", "r4"], approve: ["r3", "r5", "r6"] });

    const shown = new Set(SHOWN.map((r) => r.id));
    const per = Object.fromEntries(
      (["Dismiss", "Resolve", "Approve"] as const).map((v) => {
        const got = received[v.toLowerCase()];
        return [v, undisclosedHidden(v, got.filter((id) => !shown.has(id)).length, ALL.length)];
      }),
    );
    const total = Object.values(per).reduce((s, n) => s + n, 0);
    console.log(`[paired] undisclosed hidden deliveries: ${JSON.stringify(per)} total=${total}`);
    expect(document.body.textContent).toMatch(/6 selected · 3 hidden by the current filter/);
    expect(total).toBe(0);
  });

  it("says nothing about hiding when the filter hides no selected row", () => {
    setup(new Set(["r1", "r3"]));
    expect(document.body.textContent).not.toMatch(/hidden/);
    expect(button("Dismiss").textContent).toBe("Dismiss 2");
    expect(button("Resolve").textContent).toBe("Resolve 1");
  });

  it("drops only the hidden rows from the selection", () => {
    const { onSelectedChange } = setup(new Set(["r1", "r4", "r5"]));
    fireEvent.click(screen.getByRole("button", { name: /drop hidden/i }));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set(["r1"]));
  });

  it("keeps select-all scoped to the shown rows", () => {
    const { onSelectedChange } = setup(new Set(["r4"]));
    fireEvent.click(screen.getByLabelText("Select all shown"));
    expect(onSelectedChange).toHaveBeenCalledWith(new Set(["r4", "r1", "r2", "r3"]));
  });
});
