// The round-2 words, pinned: the verdict is judged from attributable cells only, a refused cell is a
// word in the tally and never a number, and every headline stays inside its word budget.

import { describe, expect, it } from "vitest";
import { emptyFixture, fixture, liveFixture } from "./outcome.fixture";
import { earnedVerdict, entryTitle, judgedColumn, liftSentence, refusalTally, runCells, runWord } from "./outcomeEntries";
import { foldSections, sectionDeliverables } from "./outcomeDeliverables";

describe("earnedVerdict", () => {
  it("earns with a regression when the net is up but a repo slipped", () => {
    const v = earnedVerdict(fixture, judgedColumn(fixture, null));
    expect(v.kind).toBe("earned-regressed");
    expect(v.headline).toBe("Earned another run, with a regression");
    expect(v.reason).toContain("docs-site slipped");
    expect(v.reason).toContain("▲+3 net");
  });

  it("earns cleanly on a run with no attributable regression", () => {
    const v = earnedVerdict(fixture, judgedColumn(fixture, "run-2"));
    expect(v.kind).toBe("earned");
    expect(v.reason).toBe("2 of 2 repos climbed · ▲+6 attributable");
  });

  it("refuses to judge a run whose cells were all refused, and says why in words", () => {
    const v = earnedVerdict(fixture, judgedColumn(fixture, "run-1"));
    expect(v.kind).toBe("unmeasured");
    expect(v.reason).toBe("nothing measurable — 1 within noise · 1 mock · degraded");
  });

  it("judges the selected run when it exists, else the latest", () => {
    expect(judgedColumn(fixture, "run-2")?.id).toBe("run-2");
    expect(judgedColumn(fixture, "nope")?.id).toBe("run-3");
    expect(judgedColumn(emptyFixture, null)).toBeNull();
    expect(earnedVerdict(emptyFixture, null).kind).toBe("none");
  });

  it("is 'still running' for a live run", () => {
    const v = earnedVerdict(liveFixture, judgedColumn(liveFixture, null));
    expect(v).toMatchObject({ kind: "running", headline: "Still running" });
  });
});

describe("liftSentence + refusalTally", () => {
  it("prints the number only when the fold attributed one", () => {
    expect(liftSentence(fixture.columns[2]!, runCells(fixture, "run-3"))).toBe("Climbed ▲+3 across 1 repo");
    expect(liftSentence(fixture.columns[0]!, runCells(fixture, "run-1"))).toBe("No attributable lift · 1 within noise · 1 mock · degraded");
    expect(liftSentence(liveFixture.columns[2]!, [])).toBe("Running · cycle 1 of 3");
  });

  it("titles an entry with the movers named, or counted past two", () => {
    expect(entryTitle(fixture.columns[2]!, runCells(fixture, "run-3"))).toBe("payments-api climbed ▲+6, docs-site slipped ▼-3");
    expect(entryTitle(fixture.columns[0]!, runCells(fixture, "run-1"))).toBe("No attributable lift · 1 within noise · 1 mock · degraded");
    const three = [...runCells(fixture, "run-3"), { ...runCells(fixture, "run-2")[1]!, repo: "acme/x" }];
    expect(entryTitle(fixture.columns[2]!, three)).toBe("2 repos climbed, 1 slipped · ▲+3 net");
  });

  it("gives an earlier run one word", () => {
    expect(runWord(fixture.columns[1]!, runCells(fixture, "run-2"))).toBe("climbed");
    expect(runWord(fixture.columns[0]!, runCells(fixture, "run-1"))).toBe("no lift");
    expect(runWord(liveFixture.columns[2]!, [])).toBe("live");
  });

  it("tallies refusals by word", () => {
    expect(refusalTally(runCells(fixture, "run-3"))).toBe("1 uncommitted · 1 not measured");
  });
});

describe("deliverable sections", () => {
  const rows = runCells(fixture, "run-3")[0]!.deliverables;
  it("buckets by kind in closed → installed → hardened order", () => {
    expect(sectionDeliverables(rows).map((s) => `${s.label}:${s.rows.length}`)).toEqual(["Closed:1", "Installed:1", "Hardened:3"]);
  });
  it("folds to four rows across sections and counts the rest", () => {
    const { shown, hidden } = foldSections(sectionDeliverables(rows));
    expect(shown.flatMap((s) => s.rows).length).toBe(4);
    expect(hidden).toBe(1);
  });
});
