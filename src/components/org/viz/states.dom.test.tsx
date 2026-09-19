// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatrixGrid } from "./MatrixGrid";
import { StateSwatch } from "./StateSwatch";
import {
  DECLARED_DASH,
  HATCH_ID,
  HATCH_STROKE,
  STATE_HINT,
  STATE_LABEL,
  SUPERSEDED_OPACITY,
  VIZ_STATES,
  VizDefs,
  isStruck,
  isVoid,
  rendersValue,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "./states";

// The vocabulary is the load-bearing file of the whole /org redesign: every later wave imports it,
// and a state whose encoding silently equals another state's would let two different epistemic
// claims render identically — exactly the failure the prose used to (badly) prevent.

// usePrefersReducedMotion reads window.matchMedia, which jsdom does not implement. Answer "reduce"
// so the mount entrance snaps straight to its final frame and the assertions see the real output.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

describe("the state vocabulary is complete", () => {
  it("names and explains all six states", () => {
    expect(VIZ_STATES).toEqual(["measured", "declared", "not-judged", "missing", "decided", "superseded"]);
    for (const s of VIZ_STATES) {
      expect(STATE_LABEL[s].length).toBeGreaterThan(0);
      // The hint is the demoted caveat — a real sentence, not a label repeated.
      expect(STATE_HINT[s].length).toBeGreaterThan(20);
      expect(STATE_HINT[s]).not.toBe(STATE_LABEL[s]);
      expect(stateTitle(s, "Branch protection")).toContain("Branch protection");
      expect(stateTitle(s)).toContain(STATE_HINT[s]);
    }
  });

  it("keeps the §2.4 wording where the encoding is the whole point", () => {
    expect(STATE_LABEL.declared).toMatch(/not enforced/i);
    expect(STATE_HINT["not-judged"]).toMatch(/missing evidence, not a finding/i);
    expect(STATE_HINT.missing).toMatch(/never a zero/i);
  });
});

describe("each state paints a DISTINCT encoding", () => {
  it("measured is a solid fill at full opacity", () => {
    expect(stateFill("measured", "#22c55e")).toBe("#22c55e");
    expect(stateFillOpacity("measured")).toBe(1);
    expect(stateDash("measured")).toBeUndefined();
    expect(rendersValue("measured")).toBe(true);
  });

  it("declared is outline-only with the one dash array — no fill at all", () => {
    expect(stateFill("declared")).toBe("none");
    expect(stateFillOpacity("declared")).toBe(0);
    expect(stateDash("declared")).toBe(DECLARED_DASH);
    expect(stateStroke("declared", "#22c55e")).toBe("#22c55e");
  });

  it("not-judged is the shared hatch and carries NO value", () => {
    expect(stateFill("not-judged")).toBe(`url(#${HATCH_ID})`);
    expect(rendersValue("not-judged")).toBe(false);
  });

  it("missing is a void: nothing is drawn, and it is never a value", () => {
    expect(isVoid("missing")).toBe(true);
    expect(stateFill("missing")).toBe("none");
    expect(stateStroke("missing")).toBe("none");
    expect(rendersValue("missing")).toBe(false);
  });

  it("decided rings the mark in the brand accent, heavier than an outline", () => {
    expect(stateStroke("decided")).toBe("var(--color-accent)");
    expect(stateStrokeWidth("decided")).toBe(2);
    expect(stateStrokeWidth("measured")).toBe(1);
  });

  it("superseded is half-opacity plus a strikethrough", () => {
    expect(stateOpacity("superseded")).toBe(SUPERSEDED_OPACITY);
    expect(isStruck("superseded")).toBe(true);
    expect(VIZ_STATES.filter(isStruck)).toEqual(["superseded"]);
  });

  it("no two states share the same (fill, stroke, dash, opacity, value) signature", () => {
    const sigs = VIZ_STATES.map((s) =>
      [stateFill(s), stateStroke(s), stateDash(s) ?? "-", stateFillOpacity(s), stateStrokeWidth(s), rendersValue(s)].join("|"),
    );
    expect(new Set(sigs).size).toBe(VIZ_STATES.length);
  });
});

describe("the ONE hatch definition", () => {
  it("VizDefs renders a single 45-degree, 2px pattern under the shared id", () => {
    const { container } = render(
      <svg>
        <VizDefs />
      </svg>,
    );
    const patterns = container.querySelectorAll("pattern");
    expect(patterns).toHaveLength(1);
    const p = patterns[0]!;
    expect(p.getAttribute("id")).toBe(HATCH_ID);
    expect(p.getAttribute("patternTransform")).toBe("rotate(45)");
    expect(p.querySelector("line")!.getAttribute("stroke-width")).toBe(String(HATCH_STROKE));
  });
});

describe("StateSwatch draws the real mark for every state", () => {
  it("gives each swatch the state's caveat as its accessible name", () => {
    for (const s of VIZ_STATES) {
      const { container, unmount } = render(<StateSwatch state={s} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-label")).toContain(STATE_HINT[s]);
      unmount();
    }
  });

  it("missing is the only swatch with no rect — the gap IS the mark", () => {
    const { container: miss } = render(<StateSwatch state="missing" />);
    expect(miss.querySelectorAll("[data-swatch]")).toHaveLength(0);
    expect(miss.querySelectorAll("line").length).toBeGreaterThan(0);

    const { container: meas } = render(<StateSwatch state="measured" />);
    expect(meas.querySelectorAll("[data-swatch]")).toHaveLength(1);
  });

  it("only not-judged pulls in the hatch defs", () => {
    const { container: nj } = render(<StateSwatch state="not-judged" />);
    expect(nj.querySelector("pattern")).not.toBeNull();
    expect(nj.querySelector("[data-swatch]")!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);

    const { container: dec } = render(<StateSwatch state="declared" />);
    expect(dec.querySelector("pattern")).toBeNull();
  });

  it("superseded carries the strikethrough rule", () => {
    const { container } = render(<StateSwatch state="superseded" />);
    expect(container.querySelector("[data-strike]")).not.toBeNull();
  });
});

describe("a missing measurement never renders as a zero", () => {
  const AXES = ["Declared", "Observed"];

  it("drops the numeral even when the row hands it a literal 0", () => {
    // The trap this exists to close: a row arriving with `score: 0` and `state: "missing"` (a real
    // shape — an absent metric defaulted to 0 upstream) must still render an EMPTY cell.
    render(
      <MatrixGrid
        axes={AXES}
        rows={[{ id: "r1", label: "Repo one", cells: [{ state: "missing", score: 0 }, { state: "not-judged", score: 0 }] }]}
        title="Coverage"
      />,
    );
    const grid = screen.getByRole("img", { name: /Coverage/i });
    expect(grid.querySelectorAll("[data-score]")).toHaveLength(0);
    // …and it is announced as an absence, not as a number.
    expect(screen.getByRole("cell", { name: STATE_LABEL.missing })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "0" })).not.toBeInTheDocument();
  });

  it("a measured 0 DOES render — the guard is the state, not the number", () => {
    render(
      <MatrixGrid
        axes={AXES}
        rows={[{ id: "r1", label: "Repo one", cells: [{ state: "measured", score: 0 }, { state: "missing" }] }]}
        title="Coverage"
      />,
    );
    const grid = screen.getByRole("img", { name: /Coverage/i });
    const scores = Array.from(grid.querySelectorAll("[data-score]")).map((n) => n.textContent);
    expect(scores).toEqual(["0"]);
  });

  it("a void cell draws no mark, only its frame", () => {
    const { container } = render(
      <MatrixGrid axes={["Observed"]} rows={[{ id: "r1", label: "Repo one", cells: [{ state: "missing" }] }]} />,
    );
    expect(container.querySelector('[data-state="missing"] [data-mark]')).toBeNull();
  });
});

// A compile-time pin: adding a seventh state without teaching every paint function about it is a
// type error here, not a silently unpainted mark in someone's wave.
const _exhaustive: Record<VizState, string> = STATE_LABEL;
void _exhaustive;
