// Pure builders for the PR surface of the maturity gate: a GitHub Check Run summary and a
// sticky PR comment. Given a scan report + gate result (+ an optional delta vs the previously
// persisted scan), produce the check conclusion + markdown. No I/O here — github/checks.ts
// posts what this returns. Kept pure so the exact rendered output is unit-testable.

import type { ScanReport } from "@/lib/types";
import type { GateResult } from "@/lib/scoring/gate";
import type { ScanDiff } from "@/lib/report/compare";
import { ARCHETYPE_LABEL } from "@/lib/maturity/model";

/** Hidden marker so the bot can find + update its own comment instead of stacking new ones. */
export const GATE_COMMENT_MARKER = "<!-- ascent-maturity-gate -->";

export interface GateComment {
  /** GitHub Check Run conclusion. */
  conclusion: "success" | "failure";
  /** Short check-run title (≤ ~80 chars), e.g. "Passed — L3 Augmented (58/100)". */
  title: string;
  /** Markdown for the check-run summary. */
  summary: string;
  /** Markdown for the sticky PR comment (carries the hidden marker). */
  commentBody: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function deltaPhrase(diff?: ScanDiff | null): string | null {
  if (!diff || diff.unchanged) return null;
  const parts: string[] = [];
  if (diff.overall.delta !== 0) parts.push(`overall ${signed(diff.overall.delta)}`);
  if (diff.level.changed) parts.push(`${diff.level.before.id} → ${diff.level.after.id}`);
  if (diff.posture.changed) parts.push(`posture → ${diff.posture.after.label}`);
  return parts.length ? parts.join(" · ") : null;
}

export interface GateCommentOptions {
  /** Suffix describing what `baseline` compares against, e.g. "in this PR" or "vs last scan". */
  baselineSuffix?: string;
}

/**
 * Render the maturity gate for a PR. `baseline` is a diff (after − before) the comment uses to
 * show movement, not just a static grade — for a PR gate it's the base→head diff (what the PR
 * changes); for a re-scan it's vs the previously persisted scan. `opts.baselineSuffix` labels it.
 * The failures (if any) are listed; the top gaps are framed as exploration prompts, never orders.
 */
export function buildGateComment(
  report: ScanReport,
  gate: GateResult,
  baseline?: ScanDiff | null,
  opts: GateCommentOptions = {},
): GateComment {
  const baselineSuffix = opts.baselineSuffix ?? "vs last scan";
  const { level, overallScore, posture, archetype } = report;
  const pass = gate.pass;
  const conclusion = pass ? "success" : "failure";
  const verdict = pass ? "Passed" : "Failed";
  const title = `${verdict} — ${level.id} ${level.name} (${overallScore}/100)`;

  const delta = deltaPhrase(baseline);
  const lines: string[] = [];

  lines.push(`### ${pass ? "✅" : "❌"} Ascent maturity gate — ${verdict}`);
  lines.push("");
  lines.push(
    `**${level.id} · ${level.name}** — ${overallScore}/100 · posture **${posture.label}** · ${ARCHETYPE_LABEL[archetype]} lens`,
  );
  lines.push("");
  lines.push(`Adoption **${report.adoptionScore}** · Rigor **${report.rigorScore}**${delta ? ` · _${delta} ${baselineSuffix}_` : ""}`);

  if (!pass && gate.failures.length) {
    lines.push("");
    lines.push("**Gate failures**");
    for (const f of gate.failures) lines.push(`- ${f.message}`);

    // CIGATE-4: a per-failing-dimension signal table so the check carries actionable detail, not just
    // the headline. Re-derive which dims miss their floor (the stricter of the global min + any per-dim
    // floor) from report.dimensions, and surface each one's top gap.
    const floorFor = (dimId: string) =>
      Math.max(gate.policy.minDimension ?? 0, gate.policy.minDimensionFor?.[dimId as keyof typeof gate.policy.minDimensionFor] ?? 0);
    const failingDims = report.dimensions
      .filter((d) => d.score < floorFor(d.id))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    if (failingDims.length) {
      lines.push("");
      lines.push("**Where the score falls short**");
      lines.push("| Dimension | Score | Top gap |");
      lines.push("|---|---|---|");
      for (const d of failingDims) {
        const gap = (d.gaps[0] ?? d.summary ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").slice(0, 120);
        lines.push(`| ${d.id} ${d.name} | ${d.score} → ${floorFor(d.id)} | ${gap || "—"} |`);
      }
    }
  }

  // Top exploration prompts from the roadmap — inputs, never directives (keeps the companion voice).
  const explore = report.roadmap.slice(0, 3);
  if (explore.length) {
    lines.push("");
    lines.push(pass ? "**Where this repo could grow next**" : "**Gaps to explore to clear the gate**");
    for (const r of explore) {
      const q = r.explore?.[0];
      lines.push(`- **${r.title}**${q ? ` — _${q}_` : ""}`);
    }
  }

  const summary = lines.join("\n");
  const policyBits: string[] = [];
  if (gate.policy.minLevel) policyBits.push(`min ${gate.policy.minLevel}`);
  if (typeof gate.policy.minOverall === "number") policyBits.push(`min overall ${gate.policy.minOverall}`);
  if (typeof gate.policy.minDimension === "number") policyBits.push(`no dim < ${gate.policy.minDimension}`);
  if (gate.policy.forbidPostures?.length) policyBits.push(`forbid ${gate.policy.forbidPostures.join("/")}`);

  const commentBody = [
    GATE_COMMENT_MARKER,
    summary,
    "",
    `<sub>Policy: ${policyBits.join(" · ") || "archetype default"} · scored by Ascent (${report.engine.provider})</sub>`,
  ].join("\n");

  return { conclusion, title, summary, commentBody };
}
