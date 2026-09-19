// `.ascent/lane-report.json` is written by an agent, into a worktree, unattended. So the parser's
// contract is not "reads a report" — it is "never throws, and never writes a verdict onto a row the
// lane did not dispatch". Every case below is a failure mode a real session can produce.

import { describe, expect, it } from "vitest";
import { LANE_REPORT_PATH, laneReportContract, parseLaneReport } from "@/lib/local/lane-report";

const BATCH = ["r1", "r2", "r3"];

describe("parseLaneReport — never throws", () => {
  it("treats a missing report as UNKNOWN, not as zero items", () => {
    const r = parseLaneReport(null, BATCH);
    expect(r.parsed).toBe(false);
    expect(r.items).toEqual([]);
    // The distinction the whole flag exists for: nobody said "nothing was skipped".
    expect(r.raw).toBeUndefined();
  });

  it("keeps an excerpt of unparseable output instead of losing it", () => {
    const r = parseLaneReport("{ this is not json", BATCH);
    expect(r.parsed).toBe(false);
    expect(r.raw).toContain("not json");
  });

  it("refuses a top-level array as a report", () => {
    expect(parseLaneReport('[{"recommendationId":"r1"}]', BATCH).parsed).toBe(false);
  });

  it("survives a megabyte of garbage", () => {
    const blob = JSON.stringify({ v: 1, items: [{ recommendationId: "r1", verdict: "skipped", reason: "x".repeat(1_000_000) }] });
    const r = parseLaneReport(blob, BATCH);
    expect(r.parsed).toBe(true);
    expect(r.items[0]!.reason.length).toBe(400);
  });
});

describe("parseLaneReport — the batch is the authorization boundary", () => {
  it("drops an id the lane never dispatched", () => {
    const r = parseLaneReport(
      JSON.stringify({ v: 1, items: [{ recommendationId: "someone-elses", verdict: "skipped" }, { recommendationId: "r1", verdict: "resolved" }] }),
      BATCH,
    );
    // An agent cannot adjudicate rows it was not given — a stray id would otherwise write a verdict
    // and a deferral onto another repo's backlog item.
    expect(r.items.map((i) => i.recommendationId)).toEqual(["r1"]);
  });

  it("takes the FIRST claim for an id, so a later entry cannot soften an earlier verdict", () => {
    const r = parseLaneReport(
      JSON.stringify({ v: 1, items: [{ recommendationId: "r1", verdict: "skipped", reason: "blocked" }, { recommendationId: "r1", verdict: "resolved" }] }),
      BATCH,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.verdict).toBe("skipped");
  });
});

describe("parseLaneReport — coercions", () => {
  it("coerces an unrecognised verdict to `attempted` rather than dropping the item", () => {
    const r = parseLaneReport(JSON.stringify({ v: 1, items: [{ recommendationId: "r1", verdict: "mostly-done" }] }), BATCH);
    expect(r.items[0]!.verdict).toBe("attempted");
  });

  it("never accepts `absent` from the agent — only the lane assigns it", () => {
    const r = parseLaneReport(JSON.stringify({ v: 1, items: [{ recommendationId: "r1", verdict: "absent" }] }), BATCH);
    expect(r.items[0]!.verdict).toBe("attempted");
  });

  it("caps files and lessons, and drops non-strings", () => {
    const r = parseLaneReport(
      JSON.stringify({
        v: 1,
        items: [{ recommendationId: "r1", verdict: "resolved", files: [...Array(50).keys()].map((n) => `f${n}`).concat([7 as unknown as string]) }],
        lessons: ["a", "b", "c", "d", "e", "f", 9],
      }),
      BATCH,
    );
    expect(r.items[0]!.files).toHaveLength(20);
    expect(r.lessons).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is `parsed: true` for a well-formed report that says nothing — that is still a claim", () => {
    const r = parseLaneReport(JSON.stringify({ v: 1, items: [], lessons: [] }), BATCH);
    expect(r.parsed).toBe(true);
    expect(r.items).toEqual([]);
  });

  it("gives no reason rather than inventing one", () => {
    const r = parseLaneReport(JSON.stringify({ v: 1, items: [{ recommendationId: "r1", verdict: "skipped" }] }), BATCH);
    expect(r.items[0]!.reason).toBe("");
  });
});

describe("laneReportContract", () => {
  it("names the exact ids the session may report on, and says not to commit the file", () => {
    const text = laneReportContract(BATCH);
    expect(text).toContain(LANE_REPORT_PATH);
    expect(text).toContain("r1, r2, r3");
    expect(text).toContain("Do NOT commit this file");
    // Skips are asked for as first-class answers, because a hedge is what the loop cannot act on.
    expect(text).toContain("FIRST-CLASS answers");
  });
});
