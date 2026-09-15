// Shared guidance grading, independent of detector orchestration and context-health display.

/**
 * Grade the *quality* of agent guidance (CLAUDE.md / AGENTS.md content), not just its
 * presence — this is where advanced AI-native technique shows up. Returns scored signals.
 *
 * Exported for Context Health (src/lib/analyze/context-health.ts — W4), which reuses these exact
 * graded signals as its display-only quality half so the two surfaces can never disagree about
 * what "good guidance" means. Its use THERE never feeds the score — only the D1 detector below does.
 */
export function guidanceQuality(text: string): { points: number; label: string }[] {
  const t = text.toLowerCase();
  const out: { points: number; label: string }[] = [];
  // No rule pays for LENGTH (rubric r18). Two tiers used to: 1200+ chars earned 5 and 4000+ earned 8,
  // so two characters of padding across 4000 bought 3 D1 points while every content rule below already
  // pays for the substance a long file carries. Always-on guidance is re-sent with every agent request,
  // so size is a cost the reader pays, not a quality the author earned. Evidence and the decision on
  // the saturated rules: docs/SCORING-VALIDITY.md section 4c; the boundary is pinned by calibration.test.ts (T4).
  if (
    /(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|dev|lint)|\bmake\s|pytest|go test|cargo (test|build)|##\s*(commands|build|test|scripts|development|getting started)/.test(t)
  )
    out.push({ points: 8, label: "Documents build/test/run commands" });
  if (/architect|directory structure|project structure|##\s*(overview|structure|layout)|how it works/.test(t))
    out.push({ points: 6, label: "Describes architecture / project structure" });
  if (/run (the )?tests?|after (making )?changes|before committing|verify your|definition of done|always test|make sure .* pass/.test(t))
    out.push({ points: 8, label: "Encodes test/verify-after-change discipline" });
  if (/\b(do not|don't|never|always|must not|avoid)\b|important:/.test(t))
    out.push({ points: 6, label: "Defines explicit constraints / rules" });
  if (/\bsubagent|sub-agent|\bmcp\b|model context protocol|\bhooks?\b|slash command|\bskills?\b|agents?\.md|\.cursor\b/.test(t))
    out.push({ points: 8, label: "References advanced agent tooling (MCP / hooks / subagents)" });
  if (/allowed[- ]?tools|disallowed|permission[- ]?mode|tool restriction/.test(t))
    out.push({ points: 4, label: "Specifies tool / permission policy" });
  if (/```|for example|e\.g\.|example:/.test(t)) out.push({ points: 4, label: "Includes concrete examples" });
  if (/@[a-z0-9_./-]+\.(md|ts|tsx|js|jsx|py)|@import|see \[[^\]]+\]\(/.test(t))
    out.push({ points: 4, label: "Uses file references / imports" });
  return out;
}
