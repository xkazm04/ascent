// The single markdown rendering of a maturity report for LLM consumption — the payload behind BOTH
// the report header's "Copy for LLM" chip and `GET /api/report/llm` (G5-17). One generator by
// construction: the button imports this function and the route imports this function, so a script or
// agent fetching the endpoint receives byte-for-byte what a human would have pasted out of the page.
// (Two generators would have drifted on their first divergent edit — pinned by
// src/app/api/report/llm/route.test.ts.)
//
// Pure and client-safe: types + the pure maturity/gate helpers only, no DB, no `next/*`, no Date.now
// — the same input always renders the same bytes, which is what makes the equality test meaningful.
//
// HONESTY CONTRACT. This markdown is read by a model that will act on it, and a model cannot see the
// chips the page renders around the number. So every caveat the report UI shows must survive into the
// text: mock-vs-LLM provenance (`engine.provider === "mock"` means NO model contributed — the scores
// are the deterministic rubric), `incomplete` (nothing could be scored; 0/L1 is not a measurement),
// and the scan's own `warnings`. These lead the document rather than trail it.

import type { ScanReport } from "@/lib/types";
import { isIncompleteReport } from "@/lib/scoring/gate";

/** Impact/effort/level metadata on one line, omitting whatever the roadmap item didn't carry. */
function roadmapMeta(item: ScanReport["roadmap"][number]): string {
  const bits = [`impact: ${item.impact}`, `effort: ${item.effort}`];
  if (item.levelUnlock) bits.push(`unlocks: ${item.levelUnlock}`);
  return bits.join(" · ");
}

/** Collapse newlines/pipes so a model-written summary can't break out of a markdown table row. */
function cell(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/**
 * Render `report` as the LLM briefing markdown.
 *
 * Deterministic: no clock, no randomness, no environment reads. Sections are omitted (not rendered
 * empty) when the report carries nothing for them, so a sparse report produces a short honest brief
 * rather than a scaffold of blank headings.
 */
export function reportLlmMarkdown(report: ScanReport): string {
  const { repo, level, engine } = report;
  const ref = `${repo.owner}/${repo.name}`;
  const isMock = engine.provider === "mock";
  const incomplete = isIncompleteReport(report);
  const out: string[] = [];

  out.push(`# Ascent maturity report — ${ref}`);
  out.push("");
  out.push(`${repo.url}`);
  out.push("");

  // --- Caveats first. A model that reads only the top of a long context must still see them. ---
  if (incomplete) {
    out.push(
      "> **INCOMPLETE SCAN — do not treat the score as a measurement.** No dimension could be scored " +
        "(every detector failed or returned no data), so the overall score and level are the " +
        "renormalized floor, not a verdict on this repository. Re-scan or check repository access.",
    );
    out.push("");
  }
  if (isMock) {
    out.push(
      "> **Demo scoring — no language model contributed to this report.** Scores come from the " +
        "deterministic signal rubric only (no API key was configured at scan time). Summaries, " +
        "strengths, risks and the roadmap are template-derived, not written analysis: weigh them as " +
        "signal readings, not as judgment.",
    );
    out.push("");
  }
  for (const w of report.warnings ?? []) {
    out.push(`> ⚠ ${w}`);
    out.push("");
  }

  // --- Headline ---
  out.push(
    `**Overall ${report.overallScore}/100 — ${level.id} ${level.name}** · adoption ${report.adoptionScore} · rigor ${report.rigorScore}`,
  );
  out.push("");
  if (report.headline) {
    out.push(report.headline);
    out.push("");
  }
  const facts = [
    `scanned: ${report.scannedAt}`,
    `archetype: ${report.archetype}`,
    `posture: ${report.posture.id}`,
    `confidence: ${Math.round(report.confidence * 100)}%`,
    `engine: ${engine.provider} / ${engine.model}${isMock ? " (deterministic demo)" : ""}`,
  ];
  if (repo.headSha) facts.splice(1, 0, `commit: ${repo.headSha}`);
  if (repo.primaryLanguage) facts.push(`language: ${repo.primaryLanguage}`);
  if (engine.rubricVersion) facts.push(`rubric: ${engine.rubricVersion}`);
  for (const f of facts) out.push(`- ${f}`);
  out.push("");

  // --- Dimensions ---
  if (report.dimensions.length > 0) {
    out.push("## Dimensions");
    out.push("");
    out.push("| ID | Dimension | Score | Weight | Summary |");
    out.push("| --- | --- | ---: | ---: | --- |");
    for (const d of report.dimensions) {
      out.push(
        `| ${d.id} | ${cell(d.name)} | ${d.score} | ${Math.round(d.weight * 100)}% | ${cell(d.summary)} |`,
      );
    }
    out.push("");
    // The per-dimension gaps are the actionable half of the report; a flat table alone would strand
    // them in the UI. Only dimensions that actually named gaps get a block.
    const withGaps = report.dimensions.filter((d) => d.gaps.length > 0);
    if (withGaps.length > 0) {
      out.push("### Gaps by dimension");
      out.push("");
      for (const d of withGaps) {
        out.push(`**${d.id} · ${d.name}** (${d.score}/100)`);
        for (const g of d.gaps) out.push(`- ${g}`);
        out.push("");
      }
    }
  }

  if (report.strengths.length > 0) {
    out.push("## Strengths");
    out.push("");
    for (const s of report.strengths) out.push(`- ${s}`);
    out.push("");
  }
  if (report.risks.length > 0) {
    out.push("## Risks");
    out.push("");
    for (const r of report.risks) out.push(`- ${r}`);
    out.push("");
  }

  if (report.roadmap.length > 0) {
    out.push("## Roadmap");
    out.push("");
    report.roadmap.forEach((item, i) => {
      out.push(`${i + 1}. **${item.title}** — ${item.dimension} · ${roadmapMeta(item)}`);
      if (item.rationale) out.push(`   - ${item.rationale}`);
      for (const q of item.explore ?? []) out.push(`   - _explore:_ ${q}`);
    });
    out.push("");
  }

  // --- The ask. What the pasting developer wants the model to DO with all of the above. ---
  out.push("## Ask");
  out.push("");
  out.push(
    incomplete
      ? "This scan produced no usable measurement. Do not plan work from the scores above — say so, and " +
          "help diagnose why the scan could not read this repository."
      : "Using the report above, propose the smallest set of concrete changes to this repository that " +
          "would raise the weakest dimensions, in priority order. Ground every proposal in the gaps " +
          "named above, flag any that don't apply to this codebase and why, and don't invent findings " +
          "the report doesn't contain." + (isMock ? " Note that these scores are deterministic signal readings, not model analysis." : ""),
  );
  out.push("");
  out.push("---");
  out.push(`Generated by Ascent — ${ref} · ${level.id} ${level.name} · ${report.overallScore}/100`);

  return out.join("\n");
}
