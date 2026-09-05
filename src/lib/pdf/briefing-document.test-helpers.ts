// Shared harness for the briefing-document test files (split under the 300-LOC .tsx rule):
// the element-tree walkers + the fully-populated ExecBriefing fixture. Pure relocation from
// briefing-document.test.tsx — see that file's header for why the tree is walked directly.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { BriefingDocument } from "./briefing-document";
import type { ExecBriefing } from "@/lib/org/briefing";

/** Flatten every string in a React element tree (children + string props like Document's subject). */
export function collectText(node: ReactNode, out: string[] = []): string[] {
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
export const text = (b: ExecBriefing) => collectText(BriefingDocument({ briefing: b })).join(" ");

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
export function walkTree(b: ExecBriefing): { nodes: El[]; parentOf: Map<El, El | null> } {
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

export function textOf(node: ReactNode): string {
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

export const tree = (b: ExecBriefing) => walkTree(b).nodes;

export function briefing(over: Partial<ExecBriefing> = {}): ExecBriefing {
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

