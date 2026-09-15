// @vitest-environment jsdom
//
// Pins how the scorecard READS to the enterprise buyer choosing a model from it:
//   1. a row whose zero is a decode-adapter artifact (output pinned at the harness cap) is labeled as
//      such with the docs citation — it must NOT render as "0.0 · ⚠ 0%", which discredits the product
//      rather than the model;
//   2. the same row's three matrix cells are HATCHED, and a hatched cell structurally cannot print a
//      number. Refusing to print was never enough on its own: an omitted score is an unmarked
//      absence, and the baked row genuinely carries `quality: 0, within1: 0, mae: 0` — a `mae` of 0
//      even scores a PERFECT calibration. `rendersValue("not-judged")` is what stops any of that
//      reaching the screen (docs/ORG-UX-REDESIGN.md §2.4);
//   3. the baked date alone can't tell a fresh matrix from a six-month-old one, so an aged run carries
//      a staleness note. `now` is injected so this is deterministic.
// Runs against the REAL baked data (matrix-scores.data), which is what ships.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ModelScorecard } from "./ModelScorecard";
import { MATRIX_SCORES } from "@/lib/llm/matrix-scores.data";
import { ADAPTER_ARTIFACT_LABEL, isAdapterArtifact, MATRIX_STALE_AFTER_DAYS } from "@/lib/llm/matrix-scores";
import { BYOM_ANCHOR, SCORE_AXES, matrixLabel } from "./modelScorecardViz";

const BAKED_AT = Date.parse(MATRIX_SCORES.measuredAt);
const DAY = 86_400_000;
const fresh = BAKED_AT + DAY;
const artifacts = MATRIX_SCORES.models.filter(isAdapterArtifact);
const real = MATRIX_SCORES.models.filter((m) => !isAdapterArtifact(m));
const short = (slug: string) => slug.split("/").pop()!;

/** The ranked index below the matrix — the list rows, not the SVG or its sr-only equivalent. */
const listRows = () => Array.from(document.querySelectorAll("li")).filter((li) => li.querySelector("a,span"));
const rowFor = (slug: string) => listRows().find((li) => li.textContent?.includes(short(slug)))!;
const cell = (slug: string, axis: string) => document.querySelector(`[data-cell="${slug}:${axis}"]`)!;

describe("ModelScorecard — adapter-artifact rows", () => {
  it("the baked data still contains the artifact case this renders (guards the fixture)", () => {
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it("labels the artifact row instead of showing it as a 0.0 score with a ⚠ 0% reliability chip", () => {
    render(<ModelScorecard now={fresh} />);
    const label = screen.getByText(ADAPTER_ARTIFACT_LABEL);
    const row = label.closest("li")!;
    expect(within(row).getByText(short(artifacts[0]!.model))).toBeInTheDocument();
    expect(within(row).queryByText("0.0")).toBeNull();
    expect(within(row).queryByText(/⚠\s*0%/)).toBeNull();
    expect(within(row).getByText(/docs\/features\/scanning\/llm-model-matrix\.md/)).toBeInTheDocument();
  });

  it("hatches EVERY axis of an artifact row, and a hatched cell prints no number", () => {
    render(<ModelScorecard now={fresh} />);
    for (const a of artifacts) {
      for (const axis of SCORE_AXES) {
        const g = cell(a.model, axis);
        expect(g.getAttribute("data-state")).toBe("not-judged");
        // The conflation this closes: the row's own data carries 0s (and a mae of 0 scores a perfect
        // calibration). Nothing numeric may reach the cell.
        expect(g.querySelector("[data-score]")).toBeNull();
      }
    }
  });

  it("never awards the ★ top pin to an artifact row", () => {
    render(<ModelScorecard now={fresh} />);
    const pin = screen.getByText(/★ top/);
    const pinned = pin.closest("li")!.textContent!;
    for (const a of artifacts) expect(pinned).not.toContain(short(a.model));
  });

  it("offers no 'Use ↑' affordance for a model that carries no verdict", () => {
    render(<ModelScorecard now={fresh} />);
    for (const a of artifacts) expect(rowFor(a.model).querySelector("a")).toBeNull();
  });
});

describe("ModelScorecard — measured rows", () => {
  it("draws every real model as measured on all three axes, with its score", () => {
    render(<ModelScorecard now={fresh} />);
    for (const m of real) {
      for (const axis of SCORE_AXES) {
        const g = cell(m.model, axis);
        expect(g.getAttribute("data-state")).toBe("measured");
        expect(g.querySelector("[data-score]")).not.toBeNull();
      }
    }
  });

  it("keeps the full slug and a link that lands on the OpenRouter card", () => {
    render(<ModelScorecard now={fresh} />);
    for (const m of real) {
      const row = rowFor(m.model);
      expect(row.textContent).toContain(m.model); // the slug an owner actually pastes, untruncated
      expect(row.querySelector("a")!.getAttribute("href")).toBe(`#${BYOM_ANCHOR}`);
    }
  });

  it("truncates only the matrix gutter label, never the slug in the index", () => {
    const long = real.find((m) => short(m.model).length > matrixLabel(m.model).length);
    expect(long).toBeDefined();
    render(<ModelScorecard now={fresh} />);
    expect(screen.getAllByText(matrixLabel(long!.model)).length).toBeGreaterThan(0);
    expect(rowFor(long!.model).textContent).toContain(long!.model);
  });
});

describe("ModelScorecard — staleness note", () => {
  it("stays quiet for a recent bake", () => {
    render(<ModelScorecard now={fresh} />);
    expect(screen.queryByText(/benchmark is \d+ days old/i)).toBeNull();
  });

  it("warns once the run is older than the threshold", () => {
    render(<ModelScorecard now={BAKED_AT + (MATRIX_STALE_AFTER_DAYS + 30) * DAY} />);
    const note = screen.getByText(/benchmark is \d+ days old/i);
    expect(note).toHaveAttribute("role", "status");
    expect(note.textContent).toMatch(new RegExp(`over ${MATRIX_STALE_AFTER_DAYS}`));
    expect(note.textContent).toMatch(/re-run the matrix/i);
  });
});
