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
import { isValidElement, type ReactNode } from "react";
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
