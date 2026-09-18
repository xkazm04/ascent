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
// the scan's own `warnings`, and LLM-vs-detector `discrepancies` (G1: disagreement is listed with its
// recorded outcome, never dropped or softened). Incomplete/mock/warnings lead the document; flagged
// claims sit with the score narrative so a model cannot treat a blended number as uncontested.
// `scoreIntegrity` (the header chip), `governance` (default-branch guardrails) and `aiChanges` (the
// PR evidence rows behind the AI-involved rate) are additive sections: present when the scan
// recorded them, omitted entirely when the field is absent/empty so a pre-field fixture stays
// byte-identical. Roadmap rows carry the additive `firstStep` when the scan recorded one (G2:
// invitational voice stays; the concrete move is not buried in the rationale, and a blank/absent
// field emits nothing). Counted evidence lines (`dimension.evidence`) leave as their own bullets
// (G2: a templating pass must not flatten "0 of 8 Action references pinned to a SHA" into the
// dimension catalogue table).

import type { AiChangeRecord, Governance, ScanReport } from "@/lib/types";
import { isIncompleteReport } from "@/lib/scoring/gate";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { expectedLiftClause } from "@/lib/outcomes/expected-lift";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import type { ExemplarDiff, TransferRow } from "@/lib/report/exemplar";
import { discrepancyOutcome } from "@/components/report/discrepancyOutcome";
import { integrityNotes } from "@/lib/maturity/attribution";

/** Optional context a caller can fold into the briefing. Everything here is additive and omittable. */
export interface ReportMarkdownOptions {
  /**
   * The org's measured lift map (moonshot #9), keyed by `recommendationMatchKey(dimension, title)`.
   * Absent — the anonymous/public case — renders the briefing exactly as it always rendered.
   */
  lifts?: ReadonlyMap<string, LiftDistribution> | null;
  /**
   * The "## Against exemplar" section (moonshot #34), pre-rendered by `exemplarMarkdownSection`.
   * Appended immediately before `## Ask`. ABSENT OR EMPTY MUST BE BYTE-IDENTICAL to the briefing
   * this function has always produced — that byte-stability is what keeps
   * `src/app/api/report/llm/route.test.ts` (an equality test between the endpoint and the copy chip)
   * green without either being touched.
   */
  exemplarSection?: string | null;
}

/** What `exemplarMarkdownSection` needs: the diff, and optionally the practices that transfer it. */
export interface ExemplarBrief {
  diff: ExemplarDiff;
  transfers?: readonly TransferRow[];
}

/**
 * Render an exemplar comparison as markdown for a model to act on.
 *
 * Two honesty rules survive into the text, because a model cannot see the chips the page draws
 * around a number:
 *  - the basis (rubric, engine filter, cohort population + support threshold) leads the section;
 *  - a COHORT is never attributed to a repository. `ExemplarProfile.repoFullName` is null for a
 *    cohort by construction, and this function only ever prints `label`, which for a cohort is the
 *    slice ("TypeScript · top decile"). A model told "acme/web has X" would reason about acme/web.
 */
export function exemplarMarkdownSection(brief: ExemplarBrief): string {
  const { diff } = brief;
  const out: string[] = [];
  out.push("## Against exemplar");
  out.push("");
  out.push(`Compared against **${diff.exemplar.label}** — what it has at the evidence level that this repo does not.`);
  out.push("");
  const basis = [`rubric: ${diff.basis.rubric}`, "mock-engine scans excluded"];
  if (diff.exemplar.population !== null) basis.push(`cohort population: ${diff.exemplar.population}`);
  if (diff.basis.minSupport !== null) basis.push(`signal support: ${diff.basis.minSupport} of the top decile`);
  if (!diff.basis.subjectEligible) basis.push("NOTE: this repo's own scan is outside that filter, so the two sides were measured differently");
  out.push(`> Basis — ${basis.join(" · ")}.`);
  out.push("");
  out.push(
    "> Signal-level, not semantic: evidence strings are model-phrased, so an equivalent capability " +
      "worded differently reads as absent. Treat each line as a lead to verify, not a finding.",
  );
  out.push("");

  if (diff.nothingToTransfer) {
    out.push("Nothing this exemplar has is missing here.");
    out.push("");
    return out.join("\n");
  }

  const byDim = new Map((brief.transfers ?? []).map((t) => [t.dimId, t]));
  for (const d of diff.dimensions) {
    if (d.absentSignals.length === 0) continue;
    const gap = d.scoreGap === null ? "" : ` (${d.scoreGap > 0 ? "+" : ""}${d.scoreGap})`;
    out.push(`### ${d.id} · ${d.name}${gap}`);
    out.push("");
    out.push("They have, this repo lacks:");
    for (const sig of d.absentSignals) out.push(`- ${sig}`);
    const t = byDim.get(d.id);
    if (t?.practice) out.push(`- _transfers via:_ ${t.practice.label} — ${t.practice.what}`);
    if (d.aheadSignals.length > 0) out.push(`- _this repo has, the exemplar does not:_ ${d.aheadSignals.join("; ")}`);
    out.push("");
  }
  if (diff.notComparable.length > 0) {
    out.push(
      `Not comparable (scored on only one side, so no gap is claimed): ${diff.notComparable.join(", ")}.`,
    );
    out.push("");
  }
  return out.join("\n");
}

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
 * G2: counted evidence lines must survive as their own bullets. Joining them into the dimension
 * table (or one " · "-separated cell) would flatten "0 of 8 Action references pinned to a SHA" into
 * a catalogue label. Omitted when every list is empty so pre-change fixtures stay byte-identical.
 */
function evidenceSection(report: ScanReport): string[] {
  const withEvidence = report.dimensions.filter((d) => (d.evidence ?? []).some((e) => e.trim()));
  if (withEvidence.length === 0) return [];
  const lines = ["### Evidence by dimension", ""];
  for (const d of withEvidence) {
    lines.push(`**${d.id} · ${d.name}** (${d.score}/100)`);
    for (const e of d.evidence ?? []) {
      const line = e.trim();
      if (line) lines.push(`- ${line}`);
    }
    lines.push("");
  }
  return lines;
}

/**
 * G1: the in-app "Flagged for review" panel (`ReportDiscrepancies`) must survive into the briefing a
 * model will act on. Same outcome derivation the page uses (`discrepancyOutcome`), so an export cannot
 * disagree with the chip about what a claim did. Omitted entirely when the array is empty or absent
 * (legacy fixtures / mock scans) — that omission is what keeps the pre-change byte fixture stable.
 */
function discrepancySection(report: ScanReport): string[] {
  const flags = report.discrepancies ?? [];
  if (flags.length === 0) return [];
  const lines = [
    "## Flagged for review",
    "",
    "The AI auditor flagged these deterministic signals as possibly wrong. Each row records the claim and what it did to the score. Do not treat the blended scores on these dimensions as uncontested.",
    "",
  ];
  for (const d of flags) {
    const outcome = discrepancyOutcome(d, report.scoreIntegrity);
    lines.push(`- **${d.dimension}**: ${d.claim} · **${outcome.label}** · ${outcome.hint}`);
  }
  lines.push("");
  return lines;
}

/**
 * The header's ScoreIntegrityChip, in text a model can read. Same `integrityNotes` wording so the
 * briefing cannot describe a lever the chip does not (or vice versa). Omitted when the field is
 * absent (legacy / reconstructed snapshot) — unknown is not a finding. A recorded clean run still
 * emits the heading, so "the field was set" is distinguishable from "the field was dropped".
 */
function scoreIntegritySection(report: ScanReport): string[] {
  const si = report.scoreIntegrity;
  if (!si) return [];
  const notes = integrityNotes(si);
  const lines = [
    "## Score integrity",
    "",
    "Scoring levers that can move this headline on an unchanged commit. A model cannot see the integrity chip the page draws around the number.",
    "",
  ];
  if (notes.length === 0) {
    lines.push("- No scoring levers fired on this run.");
  } else {
    for (const n of notes) lines.push(`- **${n.label}**: ${n.hint}`);
  }
  lines.push("");
  return lines;
}

/** Same yes/no the scoring prompt uses for branch-protection facts. */
function yn(b: boolean): string {
  return b ? "yes" : "no";
}

/**
 * Default-branch governance (branch protection / rulesets). Omitted when null/absent — a tokenless
 * scan has no reading, and printing "unprotected" there would be a confident false negative. An
 * object with `readable: false` is a real reading ("could not be read") and is emitted.
 */
function governanceSection(report: ScanReport): string[] {
  const g: Governance | null | undefined = report.governance;
  if (!g) return [];
  const lines = [
    "## Governance",
    "",
    "Default-branch merge guardrails from the branch-protection / rulesets read.",
    "",
  ];
  if (!g.readable) {
    lines.push(`- Branch protection (${g.defaultBranch}): could not be read (insufficient permission).`);
  } else {
    lines.push(
      `- Branch protection (${g.defaultBranch}): ${g.protected ? "protected" : "NOT protected"}; requires PR ${yn(g.requiresPullRequest)}, required approvals ${g.requiredApprovals}, status checks ${yn(g.requiresStatusChecks)}, code-owner review ${yn(g.requiresCodeOwnerReview)}, signatures ${yn(g.requiresSignatures)}, linear history ${yn(g.linearHistory)}, ${g.ruleCount} ruleset rule(s).`,
    );
  }
  lines.push("");
  return lines;
}

const AI_SIGNAL_LABEL: Record<AiChangeRecord["aiSignal"], string> = {
  authored: "agent-authored",
  marked: "AI-marked",
  trailer: "trailer",
};

function approvalPhrase(c: AiChangeRecord): string {
  if (c.approved) return c.approverLogin ? `approved by ${c.approverLogin}` : "approved";
  return c.reviewCount > 0 ? "unapproved" : "unreviewed";
}

/**
 * The PR evidence rows behind `prStats`' AI rates — the population an auditor samples. Same labels
 * the in-app panel prints (signal / tools / approver / revert). Omitted when absent or empty, never
 * printed as a 0: a reconstructed snapshot that never ran ingestion must not imply an empty set.
 */
function aiChangesSection(report: ScanReport): string[] {
  const rows = report.aiChanges;
  if (!rows || rows.length === 0) return [];
  const lines = [
    "## AI-attributed changes",
    "",
    "The PRs behind the AI-involved rate, and who approved each one. A rate cannot name them.",
    "",
  ];
  for (const c of rows) {
    const tools = c.aiTools.length > 0 ? ` · ${c.aiTools.join(", ")}` : "";
    const revert = c.revertedByPr != null ? ` · reverted by #${c.revertedByPr}` : "";
    lines.push(
      `- **#${c.prNumber}** ${cell(c.title)} · ${AI_SIGNAL_LABEL[c.aiSignal]}${tools} · ${approvalPhrase(c)}${revert}`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * Render `report` as the LLM briefing markdown.
 *
 * Deterministic: no clock, no randomness, no environment reads. Sections are omitted (not rendered
 * empty) when the report carries nothing for them, so a sparse report produces a short honest brief
 * rather than a scaffold of blank headings.
 */
export function reportLlmMarkdown(report: ScanReport, options: ReportMarkdownOptions = {}): string {
  const { repo, level, engine } = report;
  const ref = `${repo.owner}/${repo.name}`;
  const isMock = engine.provider === "mock";
  const incomplete = isIncompleteReport(report);
  const out: string[] = [];

  out.push(`# Ascent maturity report: ${ref}`);
  out.push("");
  out.push(`${repo.url}`);
  out.push("");

  // --- Caveats first (G9: mock/engine-mix in the body, not the generated-by footer). ---
  if (incomplete) {
    out.push(
      "> **INCOMPLETE SCAN: do not treat the score as a measurement.** No dimension could be scored " +
        "(every detector failed or returned no data), so the overall score and level are the " +
        "renormalized floor, not a verdict on this repository. Re-scan or check repository access.",
    );
    out.push("");
  }
  if (isMock) {
    out.push(
      "> **Demo scoring: no language model contributed to this report.** Scores come from the " +
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
    `**Overall ${report.overallScore}/100 · ${level.id} ${level.name}** · adoption ${report.adoptionScore} · rigor ${report.rigorScore}`,
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

  // The header chip lives next to this number; a model cannot see it, so the same notes travel here.
  // Omitted when the field is absent (legacy snapshot) so pre-change fixtures stay byte-identical.
  out.push(...scoreIntegritySection(report));

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
    // G2: counted evidence is the other half a flat table would strand. Own bullets, never a
    // joined catalogue cell; omitted entirely when nothing was recorded.
    out.push(...evidenceSection(report));
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

  // After the score narrative, before the roadmap a model might execute: contested dimensions must
  // be named (and their recorded outcome stated) so blended scores cannot be read as uncontested.
  out.push(...discrepancySection(report));

  // Additive process evidence the page already holds: default-branch guardrails, then the AI-PR
  // population a rate cannot name. Each omits when its field is absent/empty (G1 discrepancies
  // above are independent — setting these must not drop Flagged for review).
  out.push(...governanceSection(report));
  out.push(...aiChangesSection(report));

  if (report.roadmap.length > 0) {
    out.push("## Roadmap");
    out.push("");
    report.roadmap.forEach((item, i) => {
      out.push(`${i + 1}. **${item.title}** · ${item.dimension} · ${roadmapMeta(item)}`);
      // G2: the concrete first move is additive and invitational. Omit when the model left it
      // blank so a pre-field scan stays byte-identical; never invent a step from the rationale.
      const firstStep = item.firstStep?.trim();
      if (firstStep) out.push(`   - **First step:** ${firstStep}`);
      if (item.rationale) out.push(`   - ${item.rationale}`);
      // The org's OWN measured basis for this gap, when it has one (moonshot #9). Emitted only when
      // the clause is non-null: the model reading this must never be handed "+0" where the honest
      // answer is "nobody has measured this yet" — that is a finding it would then reason from.
      // The clause always carries its n and its instrument, so the model can weigh it.
      const clause = expectedLiftClause(options.lifts?.get(recommendationMatchKey(item.dimension, item.title)));
      if (clause) out.push(`   - _measured:_ ${clause}`);
      for (const q of item.explore ?? []) out.push(`   - _explore:_ ${q}`);
    });
    out.push("");
  }

  // The exemplar section (moonshot #34) sits between the roadmap and the ask: the model should have
  // read what a stronger repo carries before it is asked what to change. Omitted entirely when the
  // caller passed nothing — see the byte-stability note on ReportMarkdownOptions.
  if (options.exemplarSection) {
    out.push(options.exemplarSection);
    out.push("");
  }

  // --- The ask. What the pasting developer wants the model to DO with all of the above. ---
  out.push("## Ask");
  out.push("");
  const flagged = (report.discrepancies ?? []).length > 0;
  out.push(
    incomplete
      ? "This scan produced no usable measurement. Do not plan work from the scores above; say so, and " +
          "help diagnose why the scan could not read this repository."
      : "Using the report above, propose the smallest set of concrete changes to this repository that " +
          "would raise the weakest dimensions, in priority order. Ground every proposal in the gaps " +
          "named above, flag any that don't apply to this codebase and why, and don't invent findings " +
          "the report doesn't contain." +
          (flagged
            ? " Dimensions under Flagged for review are contested LLM-vs-detector disagreements; do not present their blended scores as uncontested."
            : "") +
          (isMock ? " Note that these scores are deterministic signal readings, not model analysis." : ""),
  );
  out.push("");
  out.push("---");
  out.push(`Generated by Ascent · ${ref} · ${level.id} ${level.name} · ${report.overallScore}/100`);

  return out.join("\n");
}
