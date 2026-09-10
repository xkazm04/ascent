// Markdown serialization consumes the same pure presentation rules as the UI and PDF.
import type { ExecBriefing, BriefingMove } from './briefing';
import { trajectoryNote } from '@/lib/maturity/forecast';
import { briefingHasScore, scoreBasisLine, noScoreLine, coverageLine, mockDisclosure,
  valueRealizedLine, valueRealizedHeading, benchmarkCaption, briefingTrajectory,
  engineMixCaveat, engineMixLabel, movementLine, briefingProofLine, briefingLoopProofLine,
  briefingNextMove, nextMoveLine } from './briefing-format';


/**
 * Serialize a briefing to a self-contained markdown brief — the "Copy for LLM" payload. It states the
 * current standing, strengths/weaknesses, movement and goals, and ends with an explicit ASK so a dev
 * can paste it straight into Claude Code / an LLM and get back the highest-leverage next actions.
 */
export function briefingMarkdown(b: ExecBriefing): string {
  const out: string[] = [];
  const delta = b.periodDelta == null ? "" : ` (${b.periodDelta >= 0 ? "+" : ""}${b.periodDelta} vs ${b.periodTitle} start)`;
  const moveLine = (arrow: string, m: BriefingMove) =>
    `- ${arrow} ${m.name}: ${m.dOverall >= 0 ? "+" : ""}${m.dOverall}${m.levelFrom !== m.levelTo ? ` (${m.levelFrom}→${m.levelTo})` : ""}`;

  out.push(`# Ascent AI-native engineering maturity briefing: ${b.org}`);
  out.push(`Generated ${b.generatedOn} · period: ${b.periodTitle}`);
  out.push("");
  out.push("## Standing");
  // Direction 1 — the no-score path. An all-mock fleet has `maturity.overall === 0` by division
  // guard, and this markdown is what a leader pastes into an LLM: "stands at 0/100 overall (L1)"
  // would be laundered into confident prose downstream. State the absence instead.
  if (briefingHasScore(b)) {
    out.push(`- Overall maturity: **${b.maturity.overall}/100** (${b.maturity.levelId} ${b.maturity.levelName})${delta}`);
    out.push(`- AI Adoption: ${b.maturity.adoption}/100 · Engineering Rigor: ${b.maturity.rigor}/100`);
    out.push(`- Score basis: ${scoreBasisLine(b)}`);
  } else {
    out.push(`- Overall maturity: — · ${noScoreLine(b)}`);
  }
  out.push(`- ${coverageLine(b)}`);
  const mockLine = mockDisclosure(b);
  if (mockLine) out.push(`- Provenance: ${mockLine}`);
  const vline = valueRealizedLine(b.valueRealized, b.realScoredCount);
  if (vline) out.push(`- ${valueRealizedHeading(b.valueRealized)}: ${vline}`);
  if (b.adoptionRate != null) out.push(`- Fleet adoption: ${b.adoptionRate}% of scanned repos at a high AI-adoption posture`);
  if (b.benchmark?.percentile != null) {
    out.push(`- Benchmark: ${b.benchmark.percentile}th percentile ${benchmarkCaption(b.benchmark)} (corpus avg ${b.benchmark.corpusAvgOverall})`);
  }
  if (b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null) {
    const c = b.benchmark.cohort;
    out.push(
      `- Peer cohort (${c.language}): ${c.overallPercentile}th percentile overall vs ${c.repos} ${c.language} repos${c.adoptionPercentile != null ? `; ${c.adoptionPercentile}th on AI adoption` : ""}`,
    );
  }
  // MC-B1: the markdown is what a leader pastes into an LLM and what the "Copy for LLM" button hands
  // out, so it gets the SAME composed line as the screen and the PDF — the claim with its hedge, or
  // the refusal to claim, never a slope on its own.
  const traj = briefingTrajectory(b);
  if (traj.headline) {
    const note = trajectoryNote(traj);
    out.push(`- Trajectory: ${traj.headline}${note ? ` (${note})` : ""}`);
  } else if (traj.insufficiency) {
    out.push(`- Trajectory: ${traj.insufficiency}`);
  }
  if (b.engineMix.length) {
    const caveat = engineMixCaveat(b.engineMix);
    out.push(`- Scored by: ${engineMixLabel(b.engineMix)}${caveat ? ` (⚠ ${caveat})` : ""}`);
  }
  if (b.priorPeriod) {
    const p = b.priorPeriod;
    const d = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
    out.push("");
    out.push("## vs previous period");
    out.push(`- Overall ${p.overall} → ${b.maturity.overall} (${d(p.dOverall)}) · Adoption ${d(p.dAdoption)} · Rigor ${d(p.dRigor)}`);
    for (const dim of p.dims.filter((x) => x.delta !== 0)) {
      out.push(`- ${dim.dimId} ${dim.label}: ${dim.prior} → ${dim.now} (${d(dim.delta)})`);
    }
  }
  out.push("");
  out.push("## Strengths (top dimensions)");
  for (const d of b.strengths) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  out.push("");
  out.push("## Weakest dimensions (where to focus)");
  for (const d of b.risks) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  if (b.security) out.push(`- Security (${b.security.dimId} ${b.security.label}): ${b.security.avg}/100`);
  if (b.topGainers.length || b.topRegressions.length) {
    out.push("");
    out.push("## Movement this period");
    const mline = movementLine(b.movement, b.realScoredCount);
    if (mline) out.push(`- ${mline}`);
    for (const m of b.topGainers) out.push(moveLine("▲", m));
    for (const m of b.topRegressions) out.push(moveLine("▼", m));
  }
  if (b.goals.length) {
    out.push("");
    out.push("## Goals");
    for (const g of b.goals) {
      out.push(`- ${g.label}: ${g.current}/${g.target} (${g.pct}%, ${g.pace}${g.etaDays != null ? `, ETA ~${g.etaDays}d` : ""})`);
    }
  }
  // Proof before the ask: the rollout numbers are the briefing's evidence that acting on the last
  // ask worked. Fleet-wide by construction (practices aren't segment-scoped) — say so.
  const proofLine = briefingProofLine(b.proof ?? null);
  const loopLine = briefingLoopProofLine(b.loopProof ?? null);
  if (proofLine || loopLine) {
    out.push("");
    out.push("## Proof: improvement shipped and measured");
    if (proofLine) out.push(`- Fleet-wide: ${proofLine}`);
    // SEPARATE from the practice line, never merged into it: "we merged it" and "it is on a branch
    // waiting for review" are different claims, and a board is entitled to both, distinctly.
    if (loopLine) out.push(`- Local loop: ${loopLine}`);
  }
  // Name the recommended next move from the SAME ranked list the on-screen page renders (G5-02).
  // This used to be `risks[0] ?? security`, computed only here: on a small, high-scoring fleet with
  // an empty `risks` list it printed "the fleet's weakest dimension" about D9 even when D9 was the
  // fleet's STRONGEST dimension — a board document naming a strength as the weakness. There is no
  // dimension fallback any more: no qualifying recommendation ⇒ no section.
  const move = briefingNextMove(b);
  if (move) {
    out.push("");
    out.push("## Recommended next move");
    out.push(nextMoveLine(move, b.coverage.scanned));
    const rest = (b.recommendations ?? []).slice(1);
    if (rest.length > 0) {
      out.push("");
      out.push("Next-widest gaps:");
      for (const rec of rest) {
        out.push(`- ${rec.title} (${rec.dimId}, ${rec.impact} impact, ${rec.repoCount} repo${rec.repoCount === 1 ? "" : "s"})`);
      }
    }
  }
  out.push("");
  out.push("## Ask");
  out.push(
    move
      ? `Elaborate the recommended move above ("${move.title}", ${move.dimId}) into concrete, repo-level steps: for each affected repository, the specific change to make and the practice that addresses it, then any second-order move across the next-widest gaps listed above.`
      : "Given this AI-native engineering maturity briefing, propose the highest-leverage actions to raise overall maturity next quarter, focused on the weakest dimensions above. For each action give: the concrete change, which repositories it applies to, and which dimension it should move.",
  );
  return out.join("\n");
}