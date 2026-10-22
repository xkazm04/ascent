// @vitest-environment jsdom
// The contract: the states a chart PAINTS are exactly the states its derived legend lists.
//
// Renders the real MatrixGrid and BandLadder over fixtures and reads the painted marks back out of
// the DOM (`data-state` on every cell/band, the edge's generated title), so a change to how either
// chart pads, defaults or skips a mark turns this red until the derivation follows it.

import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MatrixGrid } from "./MatrixGrid";
import { BandLadder, type LadderBand, type LadderEdge } from "./BandLadder";
import { ladderLegendStates, matrixLegendStates } from "./legendStates";
import { VIZ_STATES, stateTitle, type VizState } from "./states";
import type { MatrixRow } from "./matrixShared";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const AXES = ["Declared", "Observed", "Enforced"];

const MATRICES: Record<string, MatrixRow[]> = {
  "full rows": [
    { id: "a", label: "acme/api", cells: [{ state: "measured", score: 80 }, { state: "declared", score: 50 }, { state: "measured", score: 62 }] },
    { id: "b", label: "acme/web", cells: [{ state: "decided", score: 91 }, { state: "measured", score: 12 }, { state: "superseded", score: 40 }] },
  ],
  "a short row": [
    { id: "a", label: "acme/api", cells: [{ state: "measured", score: 80 }, { state: "measured", score: 50 }, { state: "measured", score: 62 }] },
    { id: "c", label: "acme/cli", cells: [{ state: "measured", score: 10 }] },
  ],
  "all non-decided states": [
    { id: "a", label: "acme/api", cells: [{ state: "not-judged" }, { state: "declared", score: 30 }, { state: "measured", score: 70 }] },
    { id: "b", label: "acme/web", cells: [{ state: "missing" }, { state: "superseded", score: 40 }, { state: "not-judged" }] },
  ],
};

describe("contract: MatrixGrid paints exactly the states matrixLegendStates lists", () => {
  for (const [name, rows] of Object.entries(MATRICES)) {
    it(name, () => {
      const { container } = render(<MatrixGrid axes={AXES} rows={rows} title={name} />);
      const painted = new Set([...container.querySelectorAll("[data-cell]")].map((el) => el.getAttribute("data-state")));
      expect(painted.size).toBeGreaterThan(0);
      expect(painted).toEqual(new Set(matrixLegendStates(AXES, rows)));
    });
  }
});

/** The state the edge arrow was painted in, read back from its generated `<title>`. */
function paintedEdgeState(container: HTMLElement): VizState | null {
  const title = container.querySelector("[data-edge] > title")?.textContent;
  if (title == null) return null;
  const hit = VIZ_STATES.find((s) => title.endsWith(stateTitle(s)));
  if (!hit) throw new Error(`edge title names no state: ${title}`);
  return hit;
}

const LADDERS: Record<string, { bands: LadderBand[]; edge: LadderEdge | null }> = {
  "no edge": {
    bands: [
      { id: "open", label: "Agent-authorable", state: "measured", count: 12 },
      { id: "review", label: "Review required", state: "declared", count: 0 },
    ],
    edge: null,
  },
  "a state-less edge (defaults to missing)": {
    bands: [{ id: "t0", label: "T0", state: "measured", count: 3 }],
    edge: { label: "unstated", count: 2 },
  },
  "a not-judged edge over mixed bands": {
    bands: [
      { id: "t3", label: "T3", state: "not-judged", count: 1 },
      { id: "t2", label: "T2", state: "superseded", count: 4 },
      { id: "t1", label: "T1", state: "decided", count: 2 },
    ],
    edge: { label: "placeholder", count: 1, state: "not-judged" },
  },
};

describe("contract: BandLadder paints exactly the states ladderLegendStates lists", () => {
  for (const [name, { bands, edge }] of Object.entries(LADDERS)) {
    it(name, () => {
      const { container } = render(<BandLadder bands={bands} edge={edge} title={name} />);
      const painted = new Set<string | null>([...container.querySelectorAll("[data-band]")].map((el) => el.getAttribute("data-state")));
      const edgeState = paintedEdgeState(container);
      if (edgeState) painted.add(edgeState);
      expect(painted).toEqual(new Set(ladderLegendStates(bands, edge)));
    });
  }
});
