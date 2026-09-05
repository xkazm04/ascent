// Pins executive-briefing #4 (ambiguity-ui-scan-2026-07-16): the board PDF's header asserts "the
// page, the clipboard brief, and the PDF can never disagree" — yet it silently dropped the
// "Value this period" renewal-justification line, the fleet-adoption rate, and the full movement
// scale ("N of M compared repos moved") that the exec page and briefingMarkdown both carry. The
// audience the value line was built for (leadership/renewal) is exactly the audience that gets the
// PDF unedited. This locks the three lines into the PDF for a fully-populated briefing, and their
// clean omission when the data is absent.
//
// BriefingDocument returns plain React elements, so we assert structurally on the element tree
// (same approach as security-document.test.tsx) — no @react-pdf binary render needed.

import { describe, it, expect, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { BriefingDocument } from "./briefing-document";

// The `renderToBuffer` cases below drive the REAL @react-pdf pipeline (font registration, layout,
// PDF serialization) rather than inspecting an element tree, so they are genuinely slow — they pass
// in isolation but exceed the 5s default when the full suite saturates the CPU. Raised file-locally
// rather than globally: a global bump would hide a real regression somewhere else.
vi.setConfig({ testTimeout: 30_000 });


import { text, tree, textOf, walkTree, briefing } from "./briefing-document.test-helpers";

describe("BriefingDocument — carries the value / adoption / movement-scale lines the other surfaces show", () => {
  const t = text(briefing());

  it("renders the 'Value this period' renewal-justification line, with the points figure's basis", () => {
    expect(t).toMatch(/Value this period\s*:/);
    // UAT DANA-L1-012 — the fleet delta names the set it is averaged over, so it can be reconciled
    // with the comparable-only movement line on the same page.
    expect(t).toContain("3 recommendations completed · fleet +4 pts across 8 live-scored repos · 2 repos leveled up");
  });

  // UAT DANA-L1-010 — the live board PDF printed "Value this period: … fleet -6 pts". The heading
  // follows the sign now; the regression itself is still printed in full (G1).
  it("prints a fleet REGRESSION under 'Activity this period', never under 'Value' — and still prints it", () => {
    const down = text(briefing({ valueRealized: { recsEngaged: 0, recsActioned: 1, pointsMoved: -6, reposPromoted: 0 } }));
    expect(down).toMatch(/Activity this period\s*:/);
    expect(down).not.toContain("Value this period");
    expect(down).toContain("-6 pts across 8 live-scored repos");
  });

  // UAT DANA-L1-011 — "PERCENTILE — vs 1 repos" in a headline tile.
  it("never captions a suppressed percentile with the corpus that was too small to produce it", () => {
    const thin = text(briefing({ benchmark: { percentile: null, corpusRepos: 1, corpusAvgOverall: 50, cohort: null } }));
    expect(thin).toContain("not enough peers to rank");
    expect(thin).not.toContain("vs 1 repos");
  });

  it("renders the fleet-adoption rate line", () => {
    expect(t).toContain("Fleet adoption:");
    expect(t).toMatch(/58.*% of scanned repos at a high AI-adoption posture/);
  });

  it("renders the FULL movement scale, not just the capped top-3 rows", () => {
    // 5 up + 2 down of 8 compared — the same counts briefingMarkdown prints (ASCII up/down: the
    // built-in Helvetica has no ▲/▼ glyphs).
    // UAT DANA-L1-012 — the comparable set is named as a subset of the scanned set.
    expect(t).toMatch(/7\s+of\s+8\s+repos with a comparable prior scan moved/);
    expect(t).toMatch(/of\s+8\s+live-scored/);
    expect(t).toMatch(/5\s+up \/\s+2\s+down/);
  });

  it("omits each line cleanly when the data is absent (no 'null'/'undefined'/empty 0·0·0 lines)", () => {
    const empty = text(
      briefing({
        adoptionRate: null,
        movement: { up: 0, down: 0, compared: 0 },
        valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
        topGainers: [],
        topRegressions: [],
      }),
    );
    expect(empty).not.toContain("Value this period");
    expect(empty).not.toContain("Fleet adoption");
    expect(empty).not.toContain("comparable prior scan moved");
    expect(empty).not.toMatch(/undefined|NaN/);
  });
});

// ── G5-05: Strengths/Weakest-dimensions column guards ───────────────────────────────────────────────
describe("BriefingDocument — Strengths/Weakest-dimensions column guards (G5-05)", () => {
  it("omits the Strengths heading when strengths is empty (risks present)", () => {
    const t = text(briefing({ strengths: [], risks: [{ dimId: "D9", label: "Security", avg: 41 }] }));
    expect(t).not.toContain("Strengths");
    expect(t).toContain("Weakest dimensions");
  });

  it("omits the Weakest-dimensions heading when risks is empty (strengths present)", () => {
    const t = text(briefing({ strengths: [{ dimId: "D2", label: "Testing", avg: 80 }], risks: [] }));
    expect(t).toContain("Strengths");
    expect(t).not.toContain("Weakest dimensions");
  });

  it("omits both headings when both arrays are empty", () => {
    const t = text(briefing({ strengths: [], risks: [] }));
    expect(t).not.toContain("Strengths");
    expect(t).not.toContain("Weakest dimensions");
  });

  it("renders both headings when both arrays are populated", () => {
    const t = text(briefing());
    expect(t).toContain("Strengths");
    expect(t).toContain("Weakest dimensions");
  });
});

// ── G5-06: orphan protection on dimension/movement rows + section headings ─────────────────────────
describe("BriefingDocument — page-break orphan protection (G5-06)", () => {
  it("wrap={false} on every dimension row (Strengths/Weakest columns)", () => {
    const els = tree(briefing());
    // Restrict to elements that actually carry an explicit `wrap` prop — a Text descendant's text
    // also matches the substring search, but only the row View itself sets `wrap`.
    const dimRows = els.filter(
      (el) => el.props?.wrap !== undefined && (textOf(el).includes("D2 · Testing") || textOf(el).includes("D9 · Security")),
    );
    expect(dimRows.length).toBeGreaterThan(0);
    for (const row of dimRows) expect(row.props.wrap).toBe(false);
  });

  it("wrap={false} on every movement row (top gainers/regressions)", () => {
    const els = tree(briefing());
    const moveRows = els.filter(
      (el) => el.props?.wrap !== undefined && (textOf(el).includes("api") || textOf(el).includes("legacy")),
    );
    expect(moveRows.length).toBeGreaterThan(0);
    for (const row of moveRows) expect(row.props.wrap).toBe(false);
  });

  it("wrap={false} on the prior-period delta rows", () => {
    const els = tree(
      briefing({
        priorPeriod: {
          overall: 58,
          adoption: 55,
          rigor: 60,
          dOverall: 4,
          dAdoption: 2,
          dRigor: 1,
          dims: [{ dimId: "D2", label: "Testing", prior: 70, now: 80, delta: 10 }],
        },
      }),
    );
    const priorRows = els.filter(
      (el) => el.props?.wrap !== undefined && textOf(el).includes("70") && textOf(el).includes("80"),
    );
    expect(priorRows.length).toBeGreaterThan(0);
    for (const row of priorRows) expect(row.props.wrap).toBe(false);
  });

  it("section headings (Movement/Goals/vs previous period) carry wrap={false} + minPresenceAhead so they can't orphan from their first row", () => {
    const { nodes, parentOf } = walkTree(
      briefing({
        priorPeriod: {
          overall: 58,
          adoption: 55,
          rigor: 60,
          dOverall: 4,
          dAdoption: 2,
          dRigor: 1,
          realScoredCount: 8,
          dims: [],
        },
        goals: [{ label: "Reach L4", current: 60, target: 80, pct: 75, pace: "on track", etaDays: 30 }],
      }),
    );
    for (const heading of ["Movement this period", "Goals", "vs previous period"]) {
      // Match the TEXT leaf specifically — the wrapping VIEW's own concatenated text is identical
      // to its sole Text child's ("Movement this period"), so a type-agnostic equality match picks
      // up both; only the TEXT leaf's PARENT is the wrap/minPresenceAhead-carrying View.
      const el = nodes.find((e) => e.type === "TEXT" && textOf(e) === heading);
      expect(el, `missing heading: ${heading}`).toBeDefined();
      const parent = parentOf.get(el!);
      expect(parent?.props.wrap).toBe(false);
      expect(parent?.props.minPresenceAhead).toBeGreaterThan(0);
    }
  });

  it("renders end-to-end through the real @react-pdf pipeline without throwing", async () => {
    const buf = await renderToBuffer(
      BriefingDocument({
        briefing: briefing({
          priorPeriod: {
            overall: 58,
            adoption: 55,
            rigor: 60,
            dOverall: 4,
            dAdoption: 2,
            dRigor: 1,
            realScoredCount: 8,
            dims: [{ dimId: "D2", label: "Testing", prior: 70, now: 80, delta: 10 }],
          },
          goals: [{ label: "Reach L4", current: 60, target: 80, pct: 75, pace: "on track", etaDays: 30 }],
        }),
      }) as unknown as ReactElement,
    );
    expect(buf.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Direction 1 (M1 — Dana's journey re-run for every figure this changed). The PDF is the artifact
// most likely to leave the building unedited, and it was the one printing `Stat label="Overall"
// value="0"` with `sub="L1 Ad hoc"` for a fleet whose every score was a mock placeholder.
// ---------------------------------------------------------------------------
describe("BriefingDocument — the score's denominator", () => {
  const mixed = briefing({ realScoredCount: 6, mockCount: 2 });
  const unscored = briefing({
    maturity: { overall: 0, levelId: "L1", levelName: "Ad hoc", adoption: 0, rigor: 0 },
    realScoredCount: 0,
    mockCount: 8,
    periodDelta: null,
    adoptionRate: null,
    movement: { up: 0, down: 0, compared: 0 },
    valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
    strengths: [],
    risks: [],
    security: null,
    topGainers: [],
    topRegressions: [],
  });

  it("states COVERAGE and the SCORE BASIS as two separate denominators", () => {
    const t = text(mixed);
    expect(t).toContain("Coverage: 8/12 repositories scanned");
    expect(t).toContain("averaged over 6 live-scored repositories");
  });

  it("carries the mock disclosure in the BODY, beside the engine-mix provenance (G9)", () => {
    expect(text(mixed)).toContain("2 mock placeholders excluded from every average");
    // A clean fleet gets no line at all — never "0 excluded".
    expect(text(briefing({ realScoredCount: 8, mockCount: 0 }))).not.toContain("excluded from every average");
  });

  it("prints an em dash and a REASON for a fleet with no live-scored repository — never 0, never L1", () => {
    const stats = tree(unscored).filter((e) => textOf(e).includes("Overall"));
    expect(stats.length).toBeGreaterThan(0);
    const t = text(unscored);
    // The three headline Stats carry "—", and the level caption is gone.
    expect(t).not.toContain("L1 Ad hoc");
    expect(t).toContain("No live-scored repositories in this period");
    expect(t).toContain("8 mock placeholders excluded from every average");
    // No basis line either: there is nothing to have averaged.
    expect(t).not.toContain("averaged over");
    // …and coverage is still stated in full: the fleet WAS looked at (G1 — never quieter).
    expect(t).toContain("Coverage: 8/12 repositories scanned");
  });

  it("the Overall Stat's value is the em dash, not the string '0'", () => {
    const overallStat = tree(unscored).find((e) => textOf(e) === "OVERALL" || textOf(e) === "Overall");
    expect(overallStat).toBeDefined();
    // Structural: the rendered document contains no bare "0" headline value where a grade would be.
    const t = text(unscored);
    expect(t).toMatch(/Overall\s+—/);
  });
});
