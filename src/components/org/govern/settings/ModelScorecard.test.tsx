// @vitest-environment jsdom
//
// Pins how the scorecard READS to the enterprise buyer choosing a model from it:
//   1. a row whose zero is a decode-adapter artifact (output pinned at the harness cap) is labeled as
//      such with the docs citation — it must NOT render as "0.0 · ⚠ 0%", which discredits the product
//      rather than the model;
//   2. the baked date alone can't tell a fresh matrix from a six-month-old one, so an aged run carries
//      a staleness note. `now` is injected so this is deterministic.
// Runs against the REAL baked data (matrix-scores.data), which is what ships.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ModelScorecard } from "./ModelScorecard";
import { MATRIX_SCORES } from "@/lib/llm/matrix-scores.data";
import { ADAPTER_ARTIFACT_LABEL, isAdapterArtifact, MATRIX_STALE_AFTER_DAYS } from "@/lib/llm/matrix-scores";

const BAKED_AT = Date.parse(MATRIX_SCORES.measuredAt);
const DAY = 86_400_000;
const fresh = BAKED_AT + DAY;
const artifacts = MATRIX_SCORES.models.filter(isAdapterArtifact);
const short = (slug: string) => slug.split("/").pop()!;

describe("ModelScorecard — adapter-artifact rows", () => {
  it("the baked data still contains the artifact case this renders (guards the fixture)", () => {
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it("labels the artifact row instead of showing it as a 0.0 score with a ⚠ 0% reliability chip", () => {
    render(<ModelScorecard now={fresh} />);
    // The same label also appears in the legend paragraph; take the one inside the table row.
    const label = screen.getAllByText(ADAPTER_ARTIFACT_LABEL).find((el) => el.closest("p") === null)!;
    expect(label).toBeDefined();
    const row = label.closest("div")!;
    expect(within(row).getByText(short(artifacts[0]!.model))).toBeInTheDocument();
    expect(within(row).queryByText("0.0")).toBeNull();
    expect(within(row).queryByText(/⚠\s*0%/)).toBeNull();
    expect(within(row).getByText(/docs\/features\/scanning\/llm-model-matrix\.md/)).toBeInTheDocument();
  });

  it("never awards the ★ top pin to an artifact row", () => {
    render(<ModelScorecard now={fresh} />);
    const pin = screen.getByText(/★ top/);
    const pinnedModel = pin.closest("span")!.textContent!;
    for (const a of artifacts) expect(pinnedModel).not.toContain(short(a.model));
  });

  it("still ranks and scores the real models normally", () => {
    render(<ModelScorecard now={fresh} />);
    for (const m of MATRIX_SCORES.models.filter((x) => !isAdapterArtifact(x))) {
      expect(screen.getByText(short(m.model))).toBeInTheDocument();
    }
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
