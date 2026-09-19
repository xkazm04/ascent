// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateTrack, type TrackRow } from "./StateTrack";
import { DECLARED_DASH, HATCH_ID, STATE_LABEL, VOID_DASH } from "./states";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const START = 0;
const END = 100;

const ROWS: TrackRow[] = [
  {
    id: "protection",
    label: "Branch protection",
    segments: [
      { from: 0, to: 40, state: "measured", label: "enforced" },
      { from: 40, to: 60, state: "missing", label: "not readable" },
      { from: 60, to: 100, state: "declared", label: "declared only" },
    ],
  },
  {
    id: "signing",
    label: "Commit signing",
    segments: [{ from: 20, to: 100, state: "not-judged", label: "no evidence" }],
  },
];

describe("StateTrack accessibility", () => {
  it("names every lane and its sequence of states", () => {
    render(<StateTrack rows={ROWS} start={START} end={END} title="Control ledger" />);
    const name = screen.getByRole("img", { name: /Control ledger/i }).getAttribute("aria-label")!;
    expect(name).toContain("Branch protection: measured, then no measurement, then declared, not enforced");
    expect(name).toContain("A gap in a lane is an unobserved interval, not a zero");
  });

  it("renders an sr-only table with a row per observed interval", () => {
    render(<StateTrack rows={ROWS} start={START} end={END} title="Control ledger" />);
    expect(screen.getByRole("table", { name: /Control ledger/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Branch protection" })).toBeInTheDocument();
    expect(screen.getAllByRole("rowheader", { name: /continued/ }).length).toBeGreaterThan(0);
  });
});

describe("StateTrack draws the void as a void", () => {
  it("paints no segment for a missing interval — the dotted ground shows through", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} />);
    const painted = Array.from(container.querySelectorAll("[data-segment]")).map((n) => n.getAttribute("data-segment"));
    expect(painted).toEqual(["measured", "declared", "not-judged"]);
    expect(painted).not.toContain("missing");
    // Every lane keeps its unobserved ground rule, so the gap is locatable rather than invisible.
    const grounds = container.querySelectorAll("[data-ground]");
    expect(grounds).toHaveLength(ROWS.length);
    expect(grounds[0]!.getAttribute("stroke-dasharray")).toBe(VOID_DASH);
  });

  it("marks a transition wherever the state changes, but not at the window's opening edge", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} />);
    // Lane 1: segments start at 0 (the window edge — no marker), 40 and 60. Lane 2: starts at 20.
    expect(container.querySelectorAll("[data-change]")).toHaveLength(3);
  });

  it("keeps each state's own encoding on the lane", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} />);
    expect(container.querySelector('[data-segment="declared"]')!.getAttribute("stroke-dasharray")).toBe(DECLARED_DASH);
    expect(container.querySelector('[data-segment="not-judged"]')!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
  });

  it("drops a segment with non-finite bounds instead of collapsing it onto the window start", () => {
    const { container } = render(
      <StateTrack rows={[{ id: "x", label: "X", segments: [{ from: Number.NaN, to: 50, state: "measured" }] }]} start={START} end={END} />,
    );
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(0);
    expect(screen.getByRole("img", { name: /X: never observed/i })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: STATE_LABEL.missing })).toBeInTheDocument();
  });

  it("degrades when the window is degenerate rather than dividing by zero", () => {
    const { container } = render(<StateTrack rows={ROWS} start={10} end={10} title="Control ledger" />);
    expect(screen.getByRole("img", { name: /no observation window/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the caller's pre-formatted axis ticks", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} ticks={[{ at: 0, label: "Jun" }, { at: 100, label: "Sep" }]} />);
    const labels = Array.from(container.querySelectorAll("[data-tick]")).map((t) => t.textContent);
    expect(labels).toContain("Jun");
    expect(labels).toContain("Sep");
  });
});

describe("StateTrack sets its type in HTML, not in viewBox units", () => {
  it("draws no SVG text — labels and ticks are HTML in the type scale", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} ticks={[{ at: 0, label: "Jun" }, { at: 50, label: "Jul" }]} />);
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
    expect(container.querySelector("svg[viewBox]")).toBeNull();
    expect(container.querySelector('[data-lane="protection"]')!.textContent).toContain("Branch protection");
  });

  it("positions marks and ticks in percent of the lane, so strokes never scale", () => {
    const { container } = render(<StateTrack rows={ROWS} start={START} end={END} ticks={[{ at: 50, label: "Jul" }]} />);
    const declared = container.querySelector('[data-segment="declared"]')!;
    expect(declared.getAttribute("x")).toBe("60%");
    expect(declared.getAttribute("width")).toBe("40%");
    expect((container.querySelector("[data-tick]") as HTMLElement).style.left).toBe("50%");
  });

  it("keeps the sr-only table outside the role=img element", () => {
    render(<StateTrack rows={ROWS} start={START} end={END} title="Control ledger" />);
    const img = screen.getByRole("img", { name: /Control ledger/i });
    expect(img.querySelector("table")).toBeNull();
  });
});
