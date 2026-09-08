// The privacy guarantee as a pure invariant, with the violation seeded.
//
// AGENTS.md records the failure mode this file exists to avoid: a guard that stops matching reports a
// clean codebase in a voice indistinguishable from success. So the "transcripts are never sent" claim
// is not tested by feeding it the honest ledger and watching it come back void — it is tested by
// feeding it a ledger that CLAIMS transcripts are shared, and proving the row is still two voids.

import { describe, expect, it } from "vitest";
import { careLedgerRows, careNeverSentCount, CARE_LEDGER_AXES } from "./careLedgerRows";
import { SHARING_LEDGER_OFF, type DeveloperView } from "@/lib/org/developer-view";

type Sharing = DeveloperView["setup"]["sharing"];

const states = (rows: ReturnType<typeof careLedgerRows>, id: string) =>
  rows.find((r) => r.id === id)?.cells.map((c) => c.state);

describe("careLedgerRows", () => {
  it("gives a shared row a mark on both axes: it is sent, and it is your switch", () => {
    const rows = careLedgerRows([{ field: "Session counts (30d)", shared: true }]);
    expect(states(rows, "session-counts-30d")).toEqual(["measured", "decided"]);
  });

  it("voids the SENT axis for a switch left off — while keeping the switch itself", () => {
    const rows = careLedgerRows([{ field: "Session counts (30d)", shared: false }]);
    // Not sent, but the control exists: that is what tells "off" apart from "impossible".
    expect(states(rows, "session-counts-30d")).toEqual(["missing", "decided"]);
  });

  it("voids BOTH axes for every never-sent row of the shipped ledger", () => {
    const rows = careLedgerRows(SHARING_LEDGER_OFF);
    for (const id of ["transcript-text", "prompts-diffs-file-contents", "per-person-rows-in-org-mode"]) {
      expect(states(rows, id), id).toEqual(["missing", "missing"]);
    }
  });

  it("SEEDED VIOLATION: a ledger claiming transcripts are shared still renders two voids", () => {
    // The server has no path to this state today. If one ever appears — a schema change, a bad
    // migration, a test fixture copied into production — the UI must not become the leak.
    const lying: Sharing = [
      { field: "Transcript text", shared: true, note: "never leaves your machine — not a setting" },
      { field: "Prompts, diffs, file contents", shared: true },
      { field: "Per-person rows in org mode", shared: true },
    ];
    for (const row of careLedgerRows(lying)) {
      expect(row.cells.map((c) => c.state), row.id).toEqual(["missing", "missing"]);
    }
  });

  it("locks a row whose permanence is stated only in its note — the set is not the only way in", () => {
    const rows = careLedgerRows([{ field: "Some future field", shared: true, note: "never collected" }]);
    expect(states(rows, "some-future-field")).toEqual(["missing", "missing"]);
  });

  it("counts the never-sent rows — the kicker's unit, not a hand-typed 3", () => {
    expect(careNeverSentCount(SHARING_LEDGER_OFF)).toBe(3);
    expect(careNeverSentCount([])).toBe(0);
  });

  it("keeps the axis headers short enough for the kit's 46-unit column", () => {
    // A longer header is silently clipped by MatrixGrid's viewBox — a legend row would then be the
    // only place the column's meaning exists, which is the prose problem again.
    expect(CARE_LEDGER_AXES).toHaveLength(2);
    for (const axis of CARE_LEDGER_AXES) expect(axis.length).toBeLessThanOrEqual(6);
  });
});
