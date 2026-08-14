// Pure builders for the PR surface of the maturity gate: a GitHub Check Run summary and a
// sticky PR comment. Given a scan report + gate result (+ an optional delta vs the previously
// persisted scan), produce the check conclusion + markdown. No I/O here — github/checks.ts
// posts what this returns. Kept pure so the exact rendered output is unit-testable.

import type { ScanReport } from "@/lib/types";
import type { GateResult } from "@/lib/scoring/gate";
import { describeGatePolicy, effectiveFloor, failsFloor } from "@/lib/scoring/gate";
import type { ScanDiff } from "@/lib/report/compare";
import { ARCHETYPE_LABEL } from "@/lib/maturity/model";
import { signedDelta } from "@/components/ui/format";

/** Hidden marker so the bot can find + update its own comment instead of stacking new ones. */
export const GATE_COMMENT_MARKER = "<!-- ascent-maturity-gate -->";

export interface GateComment {
  /** GitHub Check Run conclusion. `neutral` = the verdict is non-authoritative (PR head not scored). */
  conclusion: "success" | "failure" | "neutral";
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
  /**
   * Whether the report actually scored the PR HEAD ref. `false` = the head was unreachable (typical
   * for fork PRs) and the report describes the DEFAULT BRANCH instead — a verdict that structurally
   * cannot reflect anything the PR changes. The check then posts as `neutral` with an explicit
   * "default-branch verdict, PR head not scored" framing so a required-status consumer never treats
   * it as an authoritative pass/fail on the PR (github-app-installation-webhooks 2026-07-16 #3).
   * Defaults to true (the normal head-scored path).
   */
  scoredHead?: boolean;
  /**
   * Absolute URL of the full Ascent report for this scan. Rendered as a link in the sticky COMMENT
   * only — the Check Run already carries the same destination natively as `details_url`, so putting it
   * in `summary` too would duplicate it on that surface. The comment is the surface developers actually
   * read on a PR, and it had no way back to the report at all: the failures and the top-3 prompts were
   * the end of the road. Ignored unless it is an absolute http(s) URL, so a misconfigured
   * `publicBaseUrl()` renders no link rather than a broken relative one.
   */
  reportUrl?: string;
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
  const scoredHead = opts.scoredHead !== false;
  const { level, overallScore, posture, archetype } = report;
  const pass = gate.pass;
  // A fallback (default-branch) verdict must never post as a confident success/failure on the PR:
  // it is `neutral`, and every headline surface says what it actually scored.
  const conclusion: GateComment["conclusion"] = scoredHead ? (pass ? "success" : "failure") : "neutral";
  const verdict = pass ? "Passed" : "Failed";
  const title = scoredHead
    ? `${verdict}: ${level.id} ${level.name} (${overallScore}/100)`
    : `Default branch ${verdict.toLowerCase()}: PR head not scored (${level.id} ${overallScore}/100)`;

  const delta = deltaPhrase(baseline);
  const lines: string[] = [];

  // D28 two-tier naming: the free deterministic gate is the "AI-native Scorecard". Display copy only —
  // the check-run NAME stays "Ascent maturity gate" (github/checks.ts) because branch-protection
  // required-check lists pin it by exact name.
  lines.push(
    scoredHead
      ? `### ${pass ? "✅" : "❌"} Ascent AI-native Scorecard: ${verdict}`
      : `### ⚠️ Ascent AI-native Scorecard: Default-branch verdict (PR head not scored)`,
  );
  if (!scoredHead) {
    lines.push("");
    lines.push(
      "> ⚠️ **The PR head was unreachable (typical for fork PRs), so this scored the DEFAULT BRANCH " +
        "instead.** This verdict does not reflect the PR's own changes; treat it as non-authoritative " +
        "for merge decisions.",
    );
  }
  lines.push("");
  lines.push(
    `**${level.id} · ${level.name}** · ${overallScore}/100 · posture **${posture.label}** · ${ARCHETYPE_LABEL[archetype]} lens`,
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
      lines.push(`- **${r.title}**${q ? `: _${q}_` : ""}`);
    }
  }

  // Surface WHICH scoring path produced this verdict on the Check Run summary itself — not just the
  // sticky comment — so a dev blocked by the gate can tell an AI-graded verdict from the
  // deterministic-rubric floor (the keyless/mock default). Prominent when mock; quiet when live.
  const scoredByMock = report.engine.provider === "mock";
  lines.push("");
  lines.push(
    scoredByMock
      ? "> **Scored by the deterministic rubric** (no LLM), fully reproducible: same inputs, same verdict. For the AI-graded readiness briefing, configure an LLM provider."
      : `<sub>Scored by Ascent · ${mdInline(report.engine.provider)} · ${mdInline(report.engine.model)} · AI estimate, may vary between runs</sub>`,
  );

  const summary = lines.join("\n");
  // Derive the footer chips from the SAME canonical condition enumeration the governance dashboard /
  // gate URL / CI snippet use (describeGatePolicy), so the footer can't silently advertise a weaker
  // bar than the gate enforces. This now includes the per-dimension Security (D9) floor and the
  // protected-branch requirement, which the old hand-rolled list omitted.
  const policyBits = describeGatePolicy(gate.policy).map((c) => c.bit);

  // The single strongest reason to leave this gate ON, stated where the argument actually lands — on
  // the PR, next to the bar it enforces. Security (D9) is the ONE fully-deterministic dimension: its
  // score is the security check battery's risk-weighted mean, taken VERBATIM (engine.ts), and the LLM
  // only narrates it — outside the guardband blend every other dimension goes through. So a security
  // floor is a bar no model can talk its way past, and the same tree always yields the same verdict.
  // Shown only when a D9 floor is actually configured, so it stays a fact about THIS gate rather than
  // marketing on a check that doesn't enforce it. Companion voice: explains, never instructs.
  const securedByD9 = gate.policy.minDimensionFor?.D9 != null;

  // Only an absolute http(s) URL becomes a link; anything else renders nothing. Wrapped in <> (valid
  // CommonMark, honored by GitHub) so a URL containing parentheses can't terminate the link early.
  const reportUrl = /^https?:\/\//i.test(opts.reportUrl ?? "") ? opts.reportUrl : null;

  // Provider/mode now lives in `summary` (above), so the footer carries only the policy — no dupe.
  const commentBody = [
    GATE_COMMENT_MARKER,
    summary,
    "",
    // The way back to the evidence. The Check Run gets this destination as its native `details_url`,
    // but the sticky comment — the surface a developer actually reads in the PR timeline — had no link
    // to the report at all, so the verdict was a dead end for anyone wanting the reasoning behind it.
    ...(reportUrl ? [`[**See the full report →**](<${reportUrl}>)`, ""] : []),
    ...(securedByD9
      ? [
          "<sub>The Security (D9) floor is fully deterministic; its score comes straight from the security " +
            "check battery, and the language model can only narrate it, never move the number. Same tree, " +
            "same verdict.</sub>",
          "",
        ]
      : []),
    `<sub>Policy: ${policyBits.join(" · ") || "archetype default"}</sub>`,
  ].join("\n");

  return { conclusion, title, summary, commentBody };
}
