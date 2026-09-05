import { describe, expect, it } from "vitest";
import { EXEMPLAR_FLOOR, GAP_CEILING, MIN_AGREEMENT, minePracticeShapes, minedStarter, type ShapeSource } from "./practice-mining";

/** A repo whose CLAUDE.md carries `outline`, scoring `d1` on D1 (agent-guidance's dimension). */
const guidance = (repoFullName: string, d1: number, outline: string[]): ShapeSource => ({
  repoFullName,
  dims: { D1: d1 },
  shape: { version: "1", entries: [{ practiceId: "agent-guidance", path: "CLAUDE.md", outline, layout: [] }] },
});

const pick = (sources: ShapeSource[]) => minePracticeShapes(sources).find((m) => m.practiceId === "agent-guidance")!;

const STRONG = EXEMPLAR_FLOOR + 10;
const WEAK = GAP_CEILING - 10;

describe("minePracticeShapes — the house pattern is AGREEMENT", () => {
  it("keeps a heading two exemplars independently carry", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["## Commands", "## Architecture"]),
      guidance("acme/b", STRONG, ["## Commands", "## Deployment"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.outline.map((l) => l.text)).toEqual(["## Commands"]);
    expect(m.outline[0]!.agreement).toBe(2);
  });

  // The whole point. Taking the best repo's outline would promote one team's document to a standard
  // nobody agreed to — and the first person who recognizes it as THEIR file reads the feature as
  // surveillance rather than reuse.
  it("does NOT promote a single exemplar's outline, however strong it scores", () => {
    const m = pick([guidance("acme/best", 100, ["## Everything", "## We", "## Do"]), guidance("acme/gap", WEAK, [])]);
    expect(m.outline).toEqual([]);
    expect(m.offerable).toBe(false);
  });

  it("counts DISTINCT REPOS, so one verbose repo cannot manufacture a pattern", () => {
    const repeated: ShapeSource = {
      repoFullName: "acme/a",
      dims: { D5: 90 },
      shape: {
        version: "1",
        entries: [
          { practiceId: "docs-adrs", path: "adr/1.md", outline: ["## Decision"], layout: [] },
          { practiceId: "docs-adrs", path: "adr/2.md", outline: ["## Decision"], layout: [] },
        ],
      },
    };
    const m = minePracticeShapes([repeated]).find((x) => x.practiceId === "docs-adrs")!;
    expect(m.outline).toEqual([]);
  });

  it("matches headings case- and punctuation-insensitively", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["## Build & Test"]),
      guidance("acme/b", STRONG, ["## build  &  test"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.outline).toHaveLength(1);
  });

  // Normalization stops at case and punctuation ON PURPOSE. "Build & Test" and "build and test"
  // read as the same section to a human, but equating them needs a SYNONYM rule, and a synonym
  // table is where a "your own pattern" claim quietly becomes the vendor's interpretation of it.
  it("does not treat a worded variant as the same heading — that would be synonym matching", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["## Build & Test"]),
      guidance("acme/b", STRONG, ["## Build and Test"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.outline).toEqual([]);
  });

  it("treats the same text at different heading levels as different structure", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["# Commands"]),
      guidance("acme/b", STRONG, ["## Commands"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.outline).toEqual([]);
  });

  it("orders by agreement, then alphabetically, so output is stable", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["## Zebra", "## Alpha", "## Common"]),
      guidance("acme/b", STRONG, ["## Zebra", "## Alpha", "## Common"]),
      guidance("acme/c", STRONG, ["## Common"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.outline.map((l) => l.text)).toEqual(["## Common", "## Alpha", "## Zebra"]);
  });
});

describe("exemplars and gaps", () => {
  it("counts only repos at or above the exemplar floor", () => {
    const m = pick([
      guidance("acme/strong", EXEMPLAR_FLOOR, ["## A"]),
      guidance("acme/mid", EXEMPLAR_FLOOR - 1, ["## A"]),
      guidance("acme/gap", WEAK, []),
    ]);
    expect(m.exemplars).toEqual(["acme/strong"]);
    expect(m.outline).toEqual([]); // only one exemplar cleared the floor
  });

  it("lists gap repos below the ceiling", () => {
    const m = pick([guidance("acme/a", STRONG, ["## A"]), guidance("acme/b", STRONG, ["## A"]), guidance("acme/z", WEAK, [])]);
    expect(m.gapRepos).toEqual(["acme/z"]);
    expect(m.offerable).toBe(true);
  });

  // A pattern with nobody to give it to is a good state, not a task — and must not be dressed as one.
  it("is not offerable when there is a pattern but no repo lacks it", () => {
    const m = pick([guidance("acme/a", STRONG, ["## A"]), guidance("acme/b", STRONG, ["## A"])]);
    expect(m.outline).toHaveLength(1);
    expect(m.gapRepos).toEqual([]);
    expect(m.offerable).toBe(false);
  });
});

describe("layout agreement", () => {
  const harness = (repo: string, paths: string[]): ShapeSource => ({
    repoFullName: repo,
    dims: { D8: 90 },
    shape: { version: "1", entries: [{ practiceId: "ai-harness", path: "", outline: [], layout: paths }] },
  });

  // The same practice in two places is agreement, not disagreement — so the tail segments are
  // compared rather than full paths.
  it("agrees on the trailing path segments, not the full path", () => {
    const m = minePracticeShapes([
      harness("acme/a", ["evals/golden/case.yaml"]),
      harness("acme/b", ["packages/api/evals/golden/case.yaml"]),
      { repoFullName: "acme/gap", dims: { D8: 10 }, shape: { version: "1", entries: [{ practiceId: "ai-harness", path: "", outline: [], layout: ["x"] }] } },
    ]).find((x) => x.practiceId === "ai-harness")!;
    expect(m.layout.map((l) => l.text)).toEqual(["golden/case.yaml"]);
  });
});

describe("minedStarter — the fallback signal", () => {
  it("returns the mined lines when there is a real pattern", () => {
    const m = pick([
      guidance("acme/a", STRONG, ["## Commands", "## Architecture"]),
      guidance("acme/b", STRONG, ["## Commands", "## Architecture"]),
      guidance("acme/gap", WEAK, []),
    ]);
    // Equal agreement ties break alphabetically, so the starter order is stable across runs rather
    // than reflecting whichever repo happened to be read first.
    expect(minedStarter(m)).toEqual(["Architecture", "Commands"]);
  });

  // Null is the signal to fall back to the static starter — and the caller must SAY which it used,
  // because "your own pattern, from 3 repos" and "a generic starter" are very different claims.
  it("returns null when nothing was mined", () => {
    expect(minedStarter(pick([guidance("acme/solo", STRONG, ["## A"])]))).toBeNull();
  });
});

describe("shape coverage", () => {
  it("mines every practice in the catalog, offerable or not", () => {
    const all = minePracticeShapes([]);
    expect(all.length).toBeGreaterThanOrEqual(9);
    expect(all.every((m) => m.offerable === false)).toBe(true);
    expect(all.every((m) => m.exemplars.length === 0 && m.outline.length === 0)).toBe(true);
  });

  it("requires MIN_AGREEMENT to be at least 2 — one repo is never a standard", () => {
    expect(MIN_AGREEMENT).toBeGreaterThanOrEqual(2);
  });
});
