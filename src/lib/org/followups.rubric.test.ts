// @vitest-environment node
//
// A follow-up must never close on a movement the RULER made. decideInProgress is the loop certifying
// its own work, so it reads the strictest verdict attribution.ts has, and a rubric bump between the
// previous scan and this one is not repair: the row stays in progress and the ledger note names both
// rubrics, so a reader sees why the claim did not close.

import { describe, expect, it } from "vitest";
import { decideInProgress, keepNote } from "./followups";

const r = (rubricVersion: string | null) => ({ engineProvider: "claude-cli", rubricVersion });

describe("decideInProgress refuses a cross-rubric movement", () => {
  it("a gap that moved +25 across r12 -> r13 is KEPT as rubric-changed, not closed as not-restated", () => {
    const d = decideInProgress({ id: "x", kind: "gap" }, false, new Set(), { before: 20, after: 45 }, { before: r("r12"), after: r("r13") });
    expect(d).toEqual({ kind: "keep", reason: "rubric-changed" });
  });

  it("the keep note names both rubrics and carries no em dash", () => {
    const engines = { before: r("r12"), after: r("r13") };
    const movement = { before: 20, after: 45 };
    const d = decideInProgress({ id: "x", kind: "gap" }, false, new Set(), movement, engines);
    const note = keepNote(d, "abc123", movement, engines);
    expect(note).toContain("r12");
    expect(note).toContain("r13");
    expect(note).toContain("abc123");
    expect(note).not.toContain("—");
  });
});

describe("guards: the rubric rule leaves the other follow-up rules alone", () => {
  it("guard: a same-rubric real movement past the band still closes the row", () => {
    expect(
      decideInProgress({ id: "x", kind: "gap" }, false, new Set(), { before: 20, after: 45 }, { before: r("r13"), after: r("r13") }),
    ).toEqual({ kind: "done", reason: "not-restated" });
  });

  it("guard: an unknown rubric on one end refuses nothing", () => {
    expect(
      decideInProgress({ id: "x", kind: "gap" }, false, new Set(), { before: 20, after: 45 }, { before: r(null), after: r("r13") }),
    ).toEqual({ kind: "done", reason: "not-restated" });
  });

  it("guard: a craft row closes only on its trailer, whatever the rubrics", () => {
    const engines = { before: r("r12"), after: r("r13") };
    expect(decideInProgress({ id: "x", kind: "craft" }, false, new Set(["x"]), { before: 80, after: 80 }, engines)).toEqual({
      kind: "done",
      reason: "trailer",
    });
    expect(decideInProgress({ id: "x", kind: "craft" }, false, new Set(), { before: 80, after: 95 }, engines)).toEqual({
      kind: "keep",
      reason: "craft-unclaimed",
    });
  });
});
