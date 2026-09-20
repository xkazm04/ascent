// THE SHEET'S ROW AXIS, pinned. The matrix is per-(run, repo); the sheet is per-gap ACROSS runs, and
// the whole readability claim rests on that fold being right: one row per gap, content in the columns
// of the runs that touched it, BLANK everywhere else.

import { describe, expect, it } from "vitest";
import { cell, emptyFixture, fixture } from "./outcome.fixture";
import { buildSheetProjects, prCell } from "./outcomeSheetModel";
import type { OutcomeMatrix } from "./outcomeMatrix";
import { timeAgo } from "@/lib/ui";

const projects = buildSheetProjects(fixture);
const payments = projects.find((p) => p.repo === "acme/payments-api")!;

describe("buildSheetProjects — one row per gap, across runs", () => {
  it("gives a gap worked in two runs ONE row, with a cell in each of those columns and a blank in the rest", () => {
    const row = payments.rows.find((r) => r.headline === "Added a coverage gate to CI")!;
    expect(row.cells["run-1"]).toBeNull();
    expect(row.cells["run-2"]).toMatchObject({ runId: "run-2", state: "committed" });
    expect(row.cells["run-3"]).toMatchObject({ runId: "run-3", state: "committed" });
  });

  it("never repeats the project: the repo is the group header, the rows are its gaps", () => {
    expect(projects.map((p) => p.repo)).toEqual(fixture.groups.map((g) => g.repo));
    expect(payments.rows.map((r) => r.headline)).not.toContain("acme/payments-api");
    // run-2 carried two of run-3's five deliverables — the union is the row axis, not the sum.
    expect(payments.rows).toHaveLength(5);
  });

  it("keys a row by its COVERED ID, so the same gap re-worked later lands in the same row", () => {
    const one = cell({ runId: "run-1", repo: "acme/one", commits: 2, rows: [
      { headline: "Add a coverage gate", dimId: "D2", kind: "closed", covers: ["rec-1"], evidence: null, state: "proposed", laneId: "l1" },
    ] });
    // Run 2 phrases the SAME follow-up differently — a headline key would split it into two rows.
    const two = cell({ runId: "run-2", repo: "acme/one", commits: 2, rows: [
      { headline: "Added a coverage gate to CI", dimId: "D2", kind: "closed", covers: ["rec-1"], evidence: "ci.yml", state: "committed", laneId: "l2" },
    ] });
    const matrix: OutcomeMatrix = {
      ...emptyFixture,
      columns: [
        { id: "run-1", startedAt: "2026-08-01T10:00:00Z", endedAt: null, phase: "done", live: false, lift: null, agentConfig: null, cycle: 1, maxCycles: 3, repoCount: 1, gaps: 0 },
        { id: "run-2", startedAt: "2026-08-02T10:00:00Z", endedAt: null, phase: "done", live: false, lift: 4, agentConfig: null, cycle: 1, maxCycles: 3, repoCount: 1, gaps: 1 },
      ],
      groups: [{ repo: "acme/one", lift: 4, cells: { "run-1": one, "run-2": two } }],
      latestId: "run-2",
    };
    const [project] = buildSheetProjects(matrix);
    expect(project!.rows).toHaveLength(1);
    // The label is the LATEST run's wording; each run's own wording stays in its own cell.
    expect(project!.rows[0]!.headline).toBe("Added a coverage gate to CI");
    expect(project!.rows[0]!.cells["run-1"]).toMatchObject({ headline: "Add a coverage gate", state: "proposed", cover: "rec-1" });
    expect(project!.rows[0]!.cells["run-2"]).toMatchObject({ state: "committed", evidence: "ci.yml" });
  });

  it("carries the repo's per-run verdict cells and its cumulative lift on the header row", () => {
    expect(payments.lift).toBe(9);
    expect(payments.headerCells["run-1"]).toBeNull();
    expect(payments.headerCells["run-3"]?.repo).toBe("acme/payments-api");
  });

  it("offers the PR from the latest run that opened one, else from the latest run at all", () => {
    expect(prCell(payments, fixture.columns)?.prUrl).toBe("https://github.com/acme/payments-api/pull/41");
    const web = projects.find((p) => p.repo === "acme/web-app")!;
    expect(prCell(web, fixture.columns)?.runId).toBe("run-3");
  });

  it("folds an empty matrix to no projects rather than to an empty row axis", () => {
    expect(buildSheetProjects(emptyFixture)).toEqual([]);
  });
});

// A column's age is measured from an instant the CALLER owns. The cockpit renders on the server and
// hydrates in the browser; with `Date.now()` on both sides a run started 18.5 days ago printed "19d
// ago" server-side and "18d ago" after hydration, and React threw a mismatch (measured 2026-09-20).
describe("timeAgo against a fixed instant", () => {
  const start = "2026-09-02T00:00:00Z";
  const now = Date.parse("2026-09-20T12:00:00Z");

  it("reads the same whenever it is called, given the same instant", () => {
    expect(timeAgo(start, now)).toBe("18d ago");
    expect(timeAgo(start, now + 12 * 3_600_000)).toBe("19d ago");
    // The same call twice, an hour of wall clock apart, cannot drift: the instant is the argument.
    expect(timeAgo(start, now)).toBe(timeAgo(start, now));
  });

  it("still falls back to the wall clock for a caller that renders in one place only", () => {
    expect(timeAgo(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2d ago");
    expect(timeAgo(undefined, now)).toBe("unknown");
  });
});
