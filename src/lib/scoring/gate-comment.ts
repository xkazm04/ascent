// Pure builders for the PR surface of the maturity gate: a GitHub Check Run summary and a
// sticky PR comment. Given a scan report + gate result (+ an optional delta vs the previously
// persisted scan), produce the check conclusion + markdown. No I/O here — github/checks.ts
// posts what this returns. Kept pure so the exact rendered output is unit-testable.

import type { ScanReport } from "@/lib/types";
import type { GateResult } from "@/lib/scoring/gate";
import { effectiveFloor, failsFloor } from "@/lib/scoring/gate";
import type { ScanDiff } from "@/lib/report/compare";
import { ARCHETYPE_LABEL } from "@/lib/maturity/model";
import { signedDelta } from "@/components/ui/format";

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

// Escape text that reaches a rendered GitHub markdown surface. LLM-derived dimension names, gap text,
// failure messages, and the provider label are NOT trusted plain text: a `|` breaks the table, a
// newline splits a row/cell, and a literal `<!--` could forge the sticky-comment marker
// (GATE_COMMENT_MARKER) and confuse the comment-upsert matcher. mdCell is for table cells (also escapes
// pipes); mdInline is for list items / the footer (no pipe concern).
const defuseComment = (s: string) => s.replace(/<!--/g, "&lt;!--");
const mdInline = (s: string) => defuseComment(s.replace(/\n+/g, " "));
const mdCell = (s: string) => defuseComment(s.replace(/\|/g, "\\|").replace(/\n+/g, " "));

function deltaPhrase(diff?: ScanDiff | null): string | null {
  if (!diff || diff.unchanged) return null;
  const parts: string[] = [];
  if (diff.overall.delta !== 0) parts.push(`overall ${signedDelta(diff.overall.delta)}`);
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
    for (const f of gate.failures) lines.push(`- ${mdInline(f.message)}`);

    // CIGATE-4: a per-failing-dimension signal table so the check carries actionable detail, not just
    // the headline. Re-derive which dims miss their floor (the stricter of the global min + any per-dim
    // floor) from report.dimensions, and surface each one's top gap.
    const failingDims = report.dimensions
      // Include an UNSCORED (non-finite) dimension: it fails the gate closed (see gate.ts), so the
      // table must show it too rather than silently sorting it as a 0 or dropping it. failsFloor()
      // is the shared effective-floor + fail-closed check the gate verdict itself uses.
      .filter((d) => failsFloor(gate.policy, d.id, d.score))
      .sort((a, b) => (Number.isFinite(a.score) ? a.score : -1) - (Number.isFinite(b.score) ? b.score : -1))
      .slice(0, 5);
    if (failingDims.length) {
      lines.push("");
      lines.push("**Where the score falls short**");
      lines.push("| Dimension | Score | Top gap |");
      lines.push("|---|---|---|");
      for (const d of failingDims) {
        // Optional-chain the array access: an LLM/mock/legacy report can omit `gaps` entirely, and the
        // old `d.gaps[0]` threw on a FAILING gate — killing the whole check-run + sticky-comment write
        // exactly when it matters most. Escape the cell so a gap with a `|` can't break the table.
        const gap = mdCell(d.gaps?.[0] ?? d.summary ?? "").slice(0, 120);
        const score = Number.isFinite(d.score) ? d.score : "n/a";
        lines.push(`| ${mdCell(`${d.id} ${d.name}`)} | ${score} → ${effectiveFloor(gate.policy, d.id)} | ${gap || "—"} |`);
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

  // Surface WHICH scoring path produced this verdict on the Check Run summary itself — not just the
  // sticky comment — so a dev blocked by the gate can tell an AI-graded verdict from the
  // deterministic-rubric floor (the keyless/mock default). Prominent when mock; quiet when live.
  const scoredByMock = report.engine.provider === "mock";
  lines.push("");
  lines.push(
    scoredByMock
      ? "> ⚠️ **Scored by the deterministic rubric** (no LLM) — configure an LLM provider for the full AI-graded maturity verdict."
      : `<sub>Scored by Ascent — ${mdInline(report.engine.provider)} · ${mdInline(report.engine.model)}</sub>`,
  );

  const summary = lines.join("\n");
  const policyBits: string[] = [];
  if (gate.policy.minLevel) policyBits.push(`min ${gate.policy.minLevel}`);
  if (typeof gate.policy.minOverall === "number") policyBits.push(`min overall ${gate.policy.minOverall}`);
  if (typeof gate.policy.minDimension === "number") policyBits.push(`no dim < ${gate.policy.minDimension}`);
  if (gate.policy.forbidPostures?.length) policyBits.push(`forbid ${gate.policy.forbidPostures.join("/")}`);

  // Provider/mode now lives in `summary` (above), so the footer carries only the policy — no dupe.
  const commentBody = [
    GATE_COMMENT_MARKER,
    summary,
    "",
    `<sub>Policy: ${policyBits.join(" · ") || "archetype default"}</sub>`,
  ].join("\n");

  return { conclusion, title, summary, commentBody };
}
