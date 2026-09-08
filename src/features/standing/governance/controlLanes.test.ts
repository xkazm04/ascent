// The lane shaping behind the control ledger's picture.
//
// What these pin is the honesty contract the old dash sentence could only ASK for: a day nobody
// observed must be a gap (no segment at all), a day whose every observation was unreadable must be
// `not-judged` (the kit then hatches it and prints no value), and a control that did not fit the
// lane budget must be COUNTED rather than silently absent — an omitted lane and an unobserved one
// would otherwise look identical.

import { describe, expect, it } from "vitest";
import { controlLanes } from "./controlLanes";
import type { ControlObservationRow, ControlState } from "@/lib/db/control-observations";

const obs = (controlId: string, day: string, state: ControlState, repo = "acme/api"): ControlObservationRow =>
  ({
    id: `${controlId}-${day}-${repo}`,
    orgId: "o1",
    repoId: "r1",
    repoFullName: repo,
    controlId,
    state,
    value: null,
    prevState: null,
    prevValue: null,
    evidenceJson: "{}",
    source: "scan",
    actorLogin: null,
    transition: false,
    occurredAt: `${day}T09:00:00.000Z`,
    observedAt: `${day}T09:00:00.000Z`,
    scanId: null,
    jobId: null,
    deliveryId: null,
    createdAt: `${day}T09:00:00.000Z`,
  }) as ControlObservationRow;

describe("controlLanes", () => {
  it("returns null when there is nothing to draw — the card keeps its empty state", () => {
    expect(controlLanes([])).toBeNull();
  });

  it("gives a day nobody observed no segment at all — the gap IS the encoding", () => {
    const lanes = controlLanes([
      obs("branch-protection", "2026-01-01", "pass"),
      // 2026-01-02 is missing on purpose.
      obs("branch-protection", "2026-01-03", "pass"),
    ]);
    const segments = lanes!.rows[0]!.segments;
    // Two runs, not one merged bar: the day between them was never observed.
    expect(segments).toHaveLength(2);
    expect(segments[0]!.to).toBeLessThan(segments[1]!.from);
    // And `missing` is always offered to the legend, because the dotted ground is always drawn.
    expect(lanes!.states).toContain("missing");
  });

  it("hatches a day whose every observation was unreadable — missing evidence, not a finding", () => {
    const lanes = controlLanes([
      obs("advisories", "2026-01-01", "unmeasurable"),
      obs("advisories", "2026-01-01", "unmeasurable", "acme/web"),
    ]);
    expect(lanes!.rows[0]!.segments[0]!.state).toBe("not-judged");
    // No colour: a not-judged segment must not borrow the ramp a measured one is painted from.
    expect(lanes!.rows[0]!.segments[0]!.color).toBeUndefined();
    expect(lanes!.states).toContain("not-judged");
  });

  it("reads a day with ANY readable observation as measured, coloured by the operating share", () => {
    const lanes = controlLanes([
      obs("branch-protection", "2026-01-01", "pass"),
      obs("branch-protection", "2026-01-01", "unmeasurable", "acme/web"),
    ]);
    const seg = lanes!.rows[0]!.segments[0]!;
    expect(seg.state).toBe("measured");
    expect(seg.color).toMatch(/^#/);
    // The unreadable observation is still carried in the accessible label — it is not a zero and it
    // is not silence either.
    expect(seg.label).toContain("1 not readable");
  });

  it("merges adjacent days that read the same way, and keeps the tallies", () => {
    const lanes = controlLanes([
      obs("branch-protection", "2026-01-01", "pass"),
      obs("branch-protection", "2026-01-02", "pass"),
      obs("branch-protection", "2026-01-03", "pass"),
    ]);
    const segments = lanes!.rows[0]!.segments;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.label).toContain("3 observations");
    expect(segments[0]!.label).toContain("2026-01-01 → 2026-01-03");
  });

  it("does not merge across a change in reading — a red stretch stays its own run", () => {
    const lanes = controlLanes([
      obs("branch-protection", "2026-01-01", "pass"),
      obs("branch-protection", "2026-01-02", "fail"),
    ]);
    expect(lanes!.rows[0]!.segments).toHaveLength(2);
  });

  it("COUNTS the controls the lane budget could not draw", () => {
    const rows = ["a", "b", "c", "d"].map((id) => obs(id, "2026-01-01", "pass"));
    const lanes = controlLanes(rows, 2);
    expect(lanes!.rows).toHaveLength(2);
    expect(lanes!.omitted).toBe(2);
  });

  it("spans the observed window and states its dates rather than a relative age", () => {
    const lanes = controlLanes([
      obs("branch-protection", "2026-01-01", "pass"),
      obs("branch-protection", "2026-03-01", "pass"),
    ]);
    expect(lanes!.start).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(lanes!.end).toBe(Date.parse("2026-03-02T00:00:00.000Z"));
    const labels = lanes!.ticks.map((t) => t.label);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe("2026-01-01");
    expect(labels[2]).toBe("2026-03-01");
  });
});
