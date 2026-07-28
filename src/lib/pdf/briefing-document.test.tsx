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

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { BriefingDocument } from "./briefing-document";
import type { ExecBriefing } from "@/lib/org/briefing";

/** Flatten every string in a React element tree (children + string props like Document's subject). */
function collectText(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    for (const v of Object.values(props)) {
      if (typeof v === "string") out.push(v);
      else collectText(v as ReactNode, out);
    }
  }
  return out;
}

// Call the component function directly (like security-document.test.tsx) so the returned element
// tree is walkable — wrapping it in JSX would leave it un-rendered.
const text = (b: ExecBriefing) => collectText(BriefingDocument({ briefing: b })).join(" ");

// ── Element-tree walker (for prop-level assertions — G5-06's wrap/minPresenceAhead orphan guards
// aren't visible to collectText, which only gathers strings) ───────────────────────────────────────
type El = ReactElement<{ style?: unknown; children?: ReactNode; wrap?: boolean; minPresenceAhead?: number }>;

/** Walks the tree ONCE, resolving function components (DimLine, MoveLine, SectionHeading,
 *  ColumnHeading) inline — they aren't rendered by React in this direct-call test harness, so
 *  without this an unexpanded `<DimLine .../>` element (no `children` prop) hides its wrap/
 *  minPresenceAhead-carrying View entirely. Also records each host element's parent, resolved
 *  THROUGH any function-component wrappers (a heading's parent is the layout View around the
 *  <SectionHeading> call site, not something inside SectionHeading's own render). Built in one
 *  pass so every element is a stable reference — re-invoking a function component on a second walk
 *  would produce a structurally-identical but referentially-different subtree. */
function walkTree(b: ExecBriefing): { nodes: El[]; parentOf: Map<El, El | null> } {
  const nodes: El[] = [];
  const parentOf = new Map<El, El | null>();
  function walk(node: ReactNode, parent: El | null) {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, parent);
      return;
    }
    if (!isValidElement(node)) return;
    const el = node as El;
    if (typeof el.type === "function") {
      walk((el.type as (props: unknown) => ReactNode)(el.props), parent);
      return;
    }
    nodes.push(el);
    parentOf.set(el, parent);
    walk(el.props?.children, el);
  }
  walk(BriefingDocument({ briefing: b }), null);
  return { nodes, parentOf };
}

function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const el = node as El;
    if (typeof el.type === "function") return textOf((el.type as (props: unknown) => ReactNode)(el.props));
    return textOf(el.props?.children);
  }
  return "";
}

const tree = (b: ExecBriefing) => walkTree(b).nodes;

function briefing(over: Partial<ExecBriefing> = {}): ExecBriefing {
  return {
    org: "acme",
    periodTitle: "last 90 days",
    generatedOn: "2026-07-16",
    maturity: { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 },
    coverage: { scanned: 8, total: 12 },
    periodDelta: 4,
    priorPeriod: null,
    forecastHeadline: null,
    forecastConfidence: null,
    engineMix: [],
    adoptionRate: 58,
    movement: { up: 5, down: 2, compared: 8 },
    valueRealized: { recsEngaged: 5, recsActioned: 3, pointsMoved: 4, reposPromoted: 2 },
    benchmark: null,
    strengths: [{ dimId: "D2", label: "Testing", avg: 80 }],
    risks: [{ dimId: "D9", label: "Security", avg: 41 }],
    security: { dimId: "D9", label: "Security", avg: 41 },
    topGainers: [{ name: "api", dOverall: 9, levelFrom: "L2", levelTo: "L3" }],
    topRegressions: [{ name: "legacy", dOverall: -5, levelFrom: "L3", levelTo: "L3" }],
    goals: [],
    regressionCount: 1,
    ...over,
  };
}

describe("BriefingDocument — carries the value / adoption / movement-scale lines the other surfaces show", () => {
  const t = text(briefing());

  it("renders the 'Value this period' renewal-justification line", () => {
    expect(t).toContain("Value this period:");
    expect(t).toContain("3 recommendations completed · fleet +4 pts · 2 repos leveled up");
  });

  it("renders the fleet-adoption rate line", () => {
    expect(t).toContain("Fleet adoption:");
    expect(t).toMatch(/58.*% of scanned repos at a high AI-adoption posture/);
  });

  it("renders the FULL movement scale, not just the capped top-3 rows", () => {
    // 5 up + 2 down of 8 compared — the same counts briefingMarkdown prints (ASCII up/down: the
    // built-in Helvetica has no ▲/▼ glyphs).
    expect(t).toMatch(/7\s+of\s+8\s+compared repos moved/);
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
    expect(empty).not.toContain("compared repos moved");
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
            dims: [{ dimId: "D2", label: "Testing", prior: 70, now: 80, delta: 10 }],
          },
          goals: [{ label: "Reach L4", current: 60, target: 80, pct: 75, pace: "on track", etaDays: 30 }],
        }),
      }) as unknown as ReactElement,
    );
    expect(buf.length).toBeGreaterThan(0);
  });
});
