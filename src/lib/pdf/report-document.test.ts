// Pins the PDF maturity report document's two fragile behaviors (the "PDF export" sold on the Private
// tier, src/lib/pdf/report-document.tsx):
//
//   1. SCORE-BAND COLOR — `scoreColor` drives the headline number, the three axis values, and every
//      dimension row through four bands (>=80 green, >=60 accent-blue, >=40 amber, else red). A band
//      boundary slipping by one (`> 80` instead of `>= 80`) would miscolor every exported PDF. The
//      helper is un-exported, so we pin it through the rendered element tree: ReportDocument returns
//      plain React elements, so we invoke it and read the `color` style on the score/axis/dim <Text>
//      nodes — no @react-pdf binary render needed for the band assertions (pure, structural).
//
//   2. CONDITIONAL SECTIONS + NO-CRASH — the Strengths/Risks block renders only when at least one of
//      those arrays is non-empty; the header date does `new Date(report.scannedAt).toISOString()`,
//      which THROWS on an invalid/absent timestamp (surfacing as the route's opaque 500). We pin:
//      the section appears iff data is present, and that a structurally-valid ScanReport never throws
//      during a real @react-pdf `renderToBuffer` regardless of empty arrays / a missing-or-malformed
//      scannedAt — the invariant the paid export depends on.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportDocument } from "./report-document";
import type { ScanReport, DimensionResult, MaturityLevel, RepoMeta, Posture } from "@/lib/types";

// ── Band colors the component hard-codes (must mirror report-document.tsx) ──────────────────────────
const GREEN = "#16a34a"; // >= 80
const ACCENT = "#2563eb"; // >= 60
const AMBER = "#d97706"; // >= 40
const RED = "#dc2626"; // < 40

// ── Fixture builders ────────────────────────────────────────────────────────────────────────────────
function dim(overrides: Partial<DimensionResult> = {}): DimensionResult {
  return {
    id: "D1",
    name: "Adoption",
    weight: 0.2,
    score: 72,
    signalScore: 70,
    llmScore: 74,
    summary: "Healthy adoption.",
    evidence: [],
    strengths: [],
    gaps: [],
    ...overrides,
  };
}

function level(overrides: Partial<MaturityLevel> = {}): MaturityLevel {
  return { id: "L3", name: "Practicing", band: [60, 79], tagline: "t", description: "Solid practice.", ...overrides };
}

function repo(overrides: Partial<RepoMeta> = {}): RepoMeta {
  return { owner: "acme", name: "widget", url: "https://github.com/acme/widget", stars: 1, forks: 0, defaultBranch: "main", primaryLanguage: "TypeScript", ...overrides };
}

const posture: Posture = { id: "ai-native", label: "AI-native", blurb: "b" };

function makeReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    repo: repo(),
    overallScore: 72,
    level: level(),
    archetype: "team",
    adoptionScore: 65,
    rigorScore: 55,
    posture,
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [],
    dimensions: [dim()],
    headline: "Strong AI adoption with thin rigor.",
    strengths: ["Uses agents in CI"],
    risks: ["No required reviews"],
    roadmap: [],
    discrepancies: [],
    confidence: 0.82,
    scannedAt: "2026-01-15T08:00:00.000Z",
    engine: { provider: "claude-cli", model: "test" },
    ...overrides,
  };
}

// ── React element-tree walker (pure; no @react-pdf binary render) ───────────────────────────────────
type El = ReactElement<{ style?: unknown; children?: ReactNode }>;

/** Depth-first list of every React element in the tree (Document/Page/View/Text…). */
function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  flatten(el.props?.children, out);
  return out;
}

/** Concatenate the primitive (string/number) descendants of a node into one string. */
function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props?.children);
  return "";
}

/** Pull `style.color` from an element whose style may be an object or an array of objects. */
function colorOf(el: El): string | undefined {
  const style = el.props?.style;
  const layers = Array.isArray(style) ? style : [style];
  let color: string | undefined;
  for (const layer of layers) {
    if (layer && typeof layer === "object" && "color" in layer) {
      const c = (layer as { color?: unknown }).color;
      if (typeof c === "string") color = c;
    }
  }
  return color;
}

/** Render ReportDocument to its React element tree (ReportDocument is a plain function component). */
function tree(report: ScanReport): El[] {
  const root = ReportDocument({ report });
  return flatten(root);
}

/** The headline score <Text> — the one whose text equals the overall score and that carries a band color. */
function headlineColor(report: ScanReport): string | undefined {
  const target = String(report.overallScore);
  const els = tree(report);
  const match = els.find((el) => colorOf(el) != null && textOf(el).trim() === target);
  return match ? colorOf(match) : undefined;
}

describe("ReportDocument — score bands (via the rendered element tree)", () => {
  // The four bands at their exact boundaries — these are the edges a `>=` → `>` slip would break.
  const cases: Array<[number, string, string]> = [
    [100, GREEN, "top"],
    [80, GREEN, "green lower edge"],
    [79, ACCENT, "just below green"],
    [60, ACCENT, "accent lower edge"],
    [59, AMBER, "just below accent"],
    [40, AMBER, "amber lower edge"],
    [39, RED, "just below amber"],
    [0, RED, "bottom"],
  ];

  for (const [score, expected, label] of cases) {
    it(`headline score ${score} (${label}) → ${expected}`, () => {
      expect(headlineColor(makeReport({ overallScore: score }))).toBe(expected);
    });
  }

  it("the three boundary scores 80/60/40 fall on the HIGHER band (inclusive lower bound)", () => {
    expect(headlineColor(makeReport({ overallScore: 80 }))).toBe(GREEN);
    expect(headlineColor(makeReport({ overallScore: 60 }))).toBe(ACCENT);
    expect(headlineColor(makeReport({ overallScore: 40 }))).toBe(AMBER);
    // …and one below each lands in the lower band.
    expect(headlineColor(makeReport({ overallScore: 79 }))).not.toBe(GREEN);
    expect(headlineColor(makeReport({ overallScore: 59 }))).not.toBe(ACCENT);
    expect(headlineColor(makeReport({ overallScore: 39 }))).not.toBe(AMBER);
  });

  it("colors the Adoption & Rigor axis values by the SAME bands (each by its own score)", () => {
    const report = makeReport({ adoptionScore: 85, rigorScore: 45 });
    const els = tree(report);
    const adoption = els.find((el) => colorOf(el) != null && textOf(el).trim() === "85");
    const rigor = els.find((el) => colorOf(el) != null && textOf(el).trim() === "45");
    expect(adoption && colorOf(adoption)).toBe(GREEN); // 85 → green
    expect(rigor && colorOf(rigor)).toBe(AMBER); // 45 → amber
  });

  it("colors each dimension's score by its own band", () => {
    const report = makeReport({
      dimensions: [dim({ id: "D1", score: 90 }), dim({ id: "D2", score: 30 })],
    });
    const els = tree(report);
    const d1 = els.find((el) => colorOf(el) != null && textOf(el).trim() === "90/100");
    const d2 = els.find((el) => colorOf(el) != null && textOf(el).trim() === "30/100");
    expect(d1 && colorOf(d1)).toBe(GREEN);
    expect(d2 && colorOf(d2)).toBe(RED);
  });
});

describe("ReportDocument — conditional Strengths/Risks section", () => {
  // Find the section by its known header labels; absence ⇒ block was conditioned out.
  function hasStrengthsRisksBlock(report: ScanReport): boolean {
    const texts = tree(report).map((el) => textOf(el));
    return texts.includes("Strengths") && texts.includes("Risks & gaps");
  }

  it("renders the block when strengths are present (risks empty)", () => {
    expect(hasStrengthsRisksBlock(makeReport({ strengths: ["x"], risks: [] }))).toBe(true);
  });

  it("renders the block when risks are present (strengths empty)", () => {
    expect(hasStrengthsRisksBlock(makeReport({ strengths: [], risks: ["y"] }))).toBe(true);
  });

  it("OMITS the block entirely when BOTH strengths and risks are empty", () => {
    expect(hasStrengthsRisksBlock(makeReport({ strengths: [], risks: [] }))).toBe(false);
  });

  it("always renders the 'Scoring by dimension' section regardless of strengths/risks", () => {
    const texts = tree(makeReport({ strengths: [], risks: [] })).map(textOf);
    expect(texts).toContain("Scoring by dimension");
  });
});

describe("ReportDocument — scannedAt date guard (must not crash the render)", () => {
  // The component guards: `report.scannedAt ? new Date(scannedAt).toISOString().slice(0,10) : ""`.
  // An absent timestamp must short-circuit (no Invalid-Date throw); a present one must format.
  function urlLine(report: ScanReport): string {
    // The url <Text> is the node whose text starts with the repo url.
    const els = tree(report);
    const node = els.find((el) => textOf(el).startsWith(report.repo.url));
    return node ? textOf(node) : "<not found>";
  }

  it("builds the element tree without throwing when scannedAt is an empty string", () => {
    expect(() => tree(makeReport({ scannedAt: "" }))).not.toThrow();
    expect(urlLine(makeReport({ scannedAt: "" }))).not.toContain("scanned");
  });

  it("builds the element tree without throwing when scannedAt is undefined", () => {
    // Force-undefined past the type to mimic a reconstructed/legacy snapshot.
    const report = makeReport({ scannedAt: undefined as unknown as string });
    expect(() => tree(report)).not.toThrow();
    expect(urlLine(report)).not.toContain("scanned");
  });

  it("formats a valid scannedAt to its YYYY-MM-DD date", () => {
    expect(urlLine(makeReport({ scannedAt: "2026-01-15T08:00:00.000Z" }))).toContain("scanned 2026-01-15");
  });
});

// ── Full @react-pdf render smoke (the real no-crash invariant the route depends on) ─────────────────
// The element-tree assertions above never invoke @react-pdf's binary renderer. These do: a
// structurally-valid ScanReport must render to a non-empty Buffer no matter the edge shape — empty
// arrays, a missing date, boundary scores — so a real report can't blow up as the route's opaque 500.
describe("ReportDocument — full renderToBuffer never throws on edge reports", () => {
  it("renders a full report to a non-empty PDF buffer", async () => {
    const buf = await renderToBuffer(ReportDocument({ report: makeReport() }) as ReactElement);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-"); // it's actually a PDF
  });

  it("renders with empty strengths AND risks (section omitted) without throwing", async () => {
    const buf = await renderToBuffer(ReportDocument({ report: makeReport({ strengths: [], risks: [] }) }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders with an empty scannedAt without throwing (no Invalid-Date toISOString crash)", async () => {
    const buf = await renderToBuffer(ReportDocument({ report: makeReport({ scannedAt: "" }) }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders with boundary scores (0 and 100) and no dimensions without throwing", async () => {
    const report = makeReport({ overallScore: 0, adoptionScore: 100, rigorScore: 0, dimensions: [] });
    const buf = await renderToBuffer(ReportDocument({ report }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
  });
});
