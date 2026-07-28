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

import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportDocument } from "./report-document";
import type { ScanReport, DimensionResult, MaturityLevel, RepoMeta, Posture } from "@/lib/types";

// The `renderToBuffer` cases below drive the REAL @react-pdf pipeline (font registration, layout,
// PDF serialization) rather than inspecting an element tree, so they are genuinely slow — they pass
// in isolation but exceed the 5s default when the full suite saturates the CPU. Raised file-locally
// rather than globally: a global bump would hide a real regression somewhere else.
vi.setConfig({ testTimeout: 30_000 });


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

// ── G5-07: sparse/incomplete-scan caveats ───────────────────────────────────────────────────────────
describe("ReportDocument — sparse/incomplete-scan caveats (G5-07)", () => {
  it("shows the fallback 'No per-dimension scoring available' line and omits the heading when dimensions is empty", () => {
    const texts = tree(makeReport({ dimensions: [] })).map(textOf);
    expect(texts).not.toContain("Scoring by dimension");
    expect(texts).toContain("No per-dimension scoring available.");
  });

  it("renders report.warnings as a caveat block", () => {
    const texts = tree(makeReport({ warnings: ["Low coverage: only 40% of the repo could be inspected."] })).map(textOf);
    expect(texts.some((t) => t.includes("Low coverage: only 40% of the repo could be inspected."))).toBe(true);
  });

  it("renders NO caveat block when warnings is absent and the report is complete", () => {
    const texts = tree(makeReport()).map(textOf);
    expect(texts.some((t) => t.includes("⚠"))).toBe(false);
  });

  it("shows a standalone 'Incomplete scan' banner when dimensions is empty and no matching warning exists (reconstructed report predating `warnings`)", () => {
    const texts = tree(makeReport({ dimensions: [], warnings: undefined })).map(textOf);
    expect(texts.some((t) => /incomplete scan/i.test(t))).toBe(true);
  });

  it("does NOT duplicate the incomplete banner when the engine's own INCOMPLETE warning is already present", () => {
    const texts = tree(
      makeReport({
        dimensions: [],
        incomplete: true,
        warnings: ["No dimensions could be scored — every signal detector failed. This is an INCOMPLETE scan."],
      }),
    ).map(textOf);
    const incompleteBadges = texts.filter((t) => t.trim() === "⚠ Incomplete scan");
    expect(incompleteBadges.length).toBe(0);
    expect(texts.some((t) => /INCOMPLETE scan/.test(t))).toBe(true);
  });

  it("a complete report (dimensions present, incomplete undefined) shows no incomplete banner", () => {
    const texts = tree(makeReport()).map(textOf);
    expect(texts.some((t) => /incomplete scan/i.test(t))).toBe(false);
  });
});

// ── G5-08: long dimension summaries are capped ──────────────────────────────────────────────────────
describe("ReportDocument — dimension summary length cap (G5-08)", () => {
  it("truncates a very long summary with an ellipsis instead of rendering it in full", () => {
    const long = "x".repeat(1000);
    const texts = tree(makeReport({ dimensions: [dim({ summary: long })] })).map(textOf);
    const rendered = texts.find((t) => t.startsWith("xxxx"));
    expect(rendered).toBeDefined();
    expect(rendered!.length).toBeLessThan(long.length);
    expect(rendered!.endsWith("…")).toBe(true);
  });

  it("leaves a short summary untouched", () => {
    const texts = tree(makeReport({ dimensions: [dim({ summary: "Short and fine." })] })).map(textOf);
    expect(texts).toContain("Short and fine.");
  });
});

// ── G5-09: roadmap/recommendations section ──────────────────────────────────────────────────────────
describe("ReportDocument — roadmap & recommendations section (G5-09)", () => {
  const roadmapItem = (over: Partial<ScanReport["roadmap"][number]> = {}): ScanReport["roadmap"][number] => ({
    title: "Add CI-enforced test coverage gates",
    dimension: "D2",
    impact: "high",
    effort: "low",
    rationale: "Coverage regressed twice this quarter with no gate to catch it.",
    ...over,
  });

  it("omits the section entirely when roadmap is empty", () => {
    const texts = tree(makeReport({ roadmap: [] })).map(textOf);
    expect(texts).not.toContain("Roadmap & recommendations");
  });

  it("renders the section with title, impact/effort, and rationale when roadmap items exist", () => {
    const texts = tree(makeReport({ roadmap: [roadmapItem()] })).map(textOf);
    expect(texts).toContain("Roadmap & recommendations");
    expect(texts.some((t) => t.includes("Add CI-enforced test coverage gates"))).toBe(true);
    expect(texts.some((t) => t.includes("high impact") && t.includes("low effort"))).toBe(true);
    expect(texts.some((t) => t.includes("Coverage regressed twice this quarter"))).toBe(true);
  });

  it("orders items quick-wins-first: high-impact/low-effort before low-impact/high-effort", () => {
    const els = tree(
      makeReport({
        roadmap: [
          roadmapItem({ title: "Low priority item", impact: "low", effort: "high" }),
          roadmapItem({ title: "High priority item", impact: "high", effort: "low" }),
        ],
      }),
    );
    // Match the exact numbered title <Text> (not any ancestor whose concatenated text happens to
    // contain the substring — the Document/Page root's text includes BOTH titles).
    const highIdx = els.findIndex((el) => /^\d+\.\s*High priority item$/.test(textOf(el).trim()));
    const lowIdx = els.findIndex((el) => /^\d+\.\s*Low priority item$/.test(textOf(el).trim()));
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThan(highIdx);
  });

  it("truncates a very long rationale instead of rendering it in full", () => {
    const long = "gap ".repeat(200);
    const texts = tree(makeReport({ roadmap: [roadmapItem({ rationale: long })] })).map(textOf);
    const rendered = texts.find((t) => t.startsWith("gap gap"));
    expect(rendered).toBeDefined();
    expect(rendered!.length).toBeLessThan(long.length);
    expect(rendered!.endsWith("…")).toBe(true);
  });
});

// ── G5-22: long owner/name soft-break + auto-scale ──────────────────────────────────────────────────
describe("ReportDocument — long ref title (G5-22)", () => {
  // Match the h1 <Text>'s OWN text exactly (stripping the soft-break zero-width space) rather than
  // "includes both owner and name" — the outer Document/Page elements' concatenated descendant text
  // also contains both substrings, so a loose `.includes` match picks the wrong (outermost) element.
  function findH1(els: El[], owner: string, name: string): El | undefined {
    return els.find((el) => textOf(el).replace(/​/gi, "").trim() === `${owner}/${name}`);
  }

  it("scales the h1 font size down for a long owner/name and does not throw", () => {
    const longRepo = repo({ owner: "a-very-long-organization-name-indeed", name: "an-equally-long-repository-name" });
    const els = tree(makeReport({ repo: longRepo }));
    const h1 = findH1(els, longRepo.owner, longRepo.name);
    expect(h1).toBeDefined();
    const style = h1!.props?.style as { fontSize?: number } | undefined;
    expect(style?.fontSize).toBeLessThan(22);
  });

  it("keeps the normal font size for a short owner/name", () => {
    const els = tree(makeReport({ repo: repo({ owner: "acme", name: "widget" }) }));
    const h1 = findH1(els, "acme", "widget");
    expect(h1).toBeDefined();
    const style = h1!.props?.style as { fontSize?: number } | undefined;
    expect(style?.fontSize).toBe(22);
  });

  it("renders a long ref through the real @react-pdf pipeline without throwing", async () => {
    const longRepo = repo({ owner: "a-very-long-organization-name-indeed", name: "an-equally-long-repository-name-that-keeps-going" });
    const buf = await renderToBuffer(ReportDocument({ report: makeReport({ repo: longRepo }) }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
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

  it("renders a fully-incomplete, all-zero report (a true zero-dimension scan) without throwing", async () => {
    const report = makeReport({
      dimensions: [],
      incomplete: true,
      overallScore: 0,
      adoptionScore: 0,
      rigorScore: 0,
      strengths: [],
      risks: [],
      roadmap: [],
      warnings: ["No dimensions could be scored — every signal detector failed or returned no data. This is an INCOMPLETE scan, not a genuine L1 (Manual) result."],
    });
    const buf = await renderToBuffer(ReportDocument({ report }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("renders a report with a full roadmap + warnings + long content without throwing", async () => {
    const report = makeReport({
      warnings: ["Pull-request data was incomplete (GitHub returned a truncated page)."],
      dimensions: [dim({ summary: "y".repeat(2000) })],
      roadmap: [
        { title: "Item A", dimension: "D1", impact: "high", effort: "low", rationale: "z".repeat(2000) },
        { title: "Item B", dimension: "D2", impact: "medium", effort: "medium", rationale: "Short rationale." },
        { title: "Item C", dimension: "D3", impact: "low", effort: "high", rationale: "" },
      ],
    });
    const buf = await renderToBuffer(ReportDocument({ report }) as ReactElement);
    expect(buf.length).toBeGreaterThan(0);
  });
});
