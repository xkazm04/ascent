// The invariant the deleted 331-character lede used to promise in words: "A clause a run did not judge
// shows as 'not judged' — never as passing." These assert the ENCODING keeps it, which is the whole
// reason the sentence could go: a promise made by prose survives exactly as long as the next edit.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import { controlVizModel } from "./controlMatrixViz";
import type { ControlMatrixRowView } from "./controlMatrixView";

const row = (over: Partial<ControlMatrixRowView> = {}): ControlMatrixRowView => ({
  repoFullName: "acme/api",
  reportedAt: "2026-06-10T00:00:00.000Z",
  summaryOnly: false,
  specVersion: "0.3.0",
  checks: [
    { check: "control.prepush.lint", family: "control", subject: "lint", level: "pass", since: null, message: "" },
    { check: "guardrail.never-commit", family: "guardrail", subject: null, level: "unchecked", since: null, message: "git unavailable" },
  ],
  ...over,
});

describe("controlVizModel", () => {
  it("makes the columns the check families, alphabetically", () => {
    expect(controlVizModel([row()]).axes).toEqual(["control", "guardrail"]);
  });

  it("scores a judged family as the share of its clauses that passed", () => {
    const m = controlVizModel([
      row({
        checks: [
          { check: "control.a", family: "control", subject: "a", level: "pass", since: null, message: "" },
          { check: "control.b", family: "control", subject: "b", level: "fail", since: null, message: "" },
        ],
      }),
    ]);
    expect(m.rows[0]!.cells[0]).toEqual({ state: "measured", score: 50 });
  });

  it("a warn is not a pass", () => {
    const m = controlVizModel([
      row({ checks: [{ check: "control.a", family: "control", subject: "a", level: "warn", since: null, message: "" }] }),
    ]);
    expect(m.rows[0]!.cells[0]).toEqual({ state: "measured", score: 0 });
  });

  it("hatches a family whose every clause was unchecked, and prints NO number for it", () => {
    const m = controlVizModel([row()]);
    const guardrail = m.rows[0]!.cells[1]!;
    expect(guardrail.state).toBe("not-judged");
    expect(guardrail.score).toBeUndefined();
    // The structural half: the kit refuses to render a value for this state at all.
    expect(rendersValue(guardrail.state)).toBe(false);
  });

  it("hatches a column a repo never reported — the same state, because both mean 'no result'", () => {
    const m = controlVizModel([
      row({ repoFullName: "acme/api" }),
      row({
        repoFullName: "acme/web",
        checks: [{ check: "control.prepush.lint", family: "control", subject: "lint", level: "pass", since: null, message: "" }],
      }),
    ]);
    expect(m.axes).toEqual(["control", "guardrail"]);
    expect(m.rows[1]!.cells[1]!.state).toBe("not-judged");
    expect(m.rows[1]!.cells[1]!.score).toBeUndefined();
  });

  it("gives a summary-only reporter no passing cell anywhere", () => {
    const m = controlVizModel([row(), row({ repoFullName: "acme/web", summaryOnly: true, checks: [] })]);
    expect(m.rows[1]!.cells.every((c) => c.state === "not-judged")).toBe(true);
  });

  it("lists only the states actually on screen, in kit order", () => {
    expect(controlVizModel([row()]).states).toEqual(["measured", "not-judged"]);
    const allJudged = controlVizModel([
      row({ checks: [{ check: "control.a", family: "control", subject: "a", level: "pass", since: null, message: "" }] }),
    ]);
    expect(allJudged.states).toEqual(["measured"]);
  });

  it("returns an empty model for an empty fleet rather than inventing a column", () => {
    expect(controlVizModel([])).toEqual({ axes: [], rows: [], states: [] });
  });
});
