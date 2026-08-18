// FOLLOW-UPS — the loop that turns a scan's gaps into a batch a local coding agent can resolve, and
// turns the next scan into the feedback that closes them. Pure; the DB and HTTP edges live in
// scans-persist.ts and /api/org/followups/handoff.
//
// WHY THIS EXISTS. Ascent produced gaps in several places (report roadmap, Backlog tab, Plan tab,
// practices) with assignees, due dates, initiatives, simulators — planning machinery sized for a
// quarter, for work that is usually one Claude Code session. The mechanism here is sized for the
// session: pick a batch → get ONE prompt → paste it into the local tool → let the next scan of that
// branch tell Ascent what got done. Three moving parts:
//
//   1. THE PROMPT (buildFixPrompt). One prompt per repository — a prompt is for one codebase — that
//      states each gap as the scan found it (title, dimension, why it matters, what to explore) and
//      asks for a commit trailer per resolved item. Grounded in the scan's own words; no new prose.
//
//   2. THE TRAILER (FOLLOWUP_TRAILER, parseResolvedIds). `Ascent-Resolves: <id>` in a commit message.
//      A scan already reads recent commit messages (that is how AI trailers are attributed), so a
//      resolution stamped this way is a positive, deterministic signal that costs the agent one line.
//
//   3. THE RESOLVE RULE (decideInProgress). On the next scan of the repo, an item a user handed off
//      (status in_progress) is DONE when a commit carries its trailer, or when the new assessment
//      no longer restates it (title match, tiers 1-2 only). It STAYS in_progress when the new scan
//      restates it. Tier-3 pairing ("the lone unmatched item in the dimension is the same gap") is
//      deliberately NOT applied to in-progress rows: since r6 every below-green dimension always has
//      SOME item, so tier 3 would pair a fixed gap with whatever new gap the dimension produced next
//      and carry "in progress" onto work nobody took on. A claimed item is carried only by its title;
//      if the scan does not say it again, the claim is honoured as resolved.

import type { RecIdentity } from "@/lib/report/compare";
import { normalizeRecTitle } from "@/lib/report/compare";

/** The commit-message trailer a fix commit uses to name the follow-up it resolves. */
export const FOLLOWUP_TRAILER = "Ascent-Resolves";

/** One follow-up as the prompt and the ledger see it. `id` is the persisted Recommendation id. */
export interface FollowUpItem {
  id: string;
  repo: string;
  title: string;
  dimId: string;
  dimLabel: string;
  impact: string;
  effort: string;
  rationale: string;
  explore: string[];
  /** Overall-score points the repo gains if this gap closes; null when unknown. */
  projectedPoints: number | null;
}

/** Ids named by `Ascent-Resolves:` trailers across a set of commit messages. Case-insensitive on
 *  the key; accepts several ids per line (comma/space separated) and several trailer lines. */
export function parseResolvedIds(messages: readonly string[]): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`^\\s*${FOLLOWUP_TRAILER}\\s*:\\s*(.+)$`, "gim");
  for (const m of messages) {
    for (const hit of m.matchAll(re)) {
      for (const id of hit[1]!.split(/[\s,]+/)) if (id) out.add(id.trim());
    }
  }
  return out;
}

export type InProgressDecision =
  | { kind: "done"; reason: "trailer"; sha?: string }
  | { kind: "done"; reason: "not-restated" }
  | { kind: "keep" };

/**
 * Decide the fate of ONE in-progress row from the previous scan. Pure.
 * - `restated`: the new scan restated it (a tier-1/2 title match).
 * - `resolvedIds`: ids named by trailers in the new scan's commit sample.
 */
export function decideInProgress(row: { id: string }, restated: boolean, resolvedIds: ReadonlySet<string>): InProgressDecision {
  if (resolvedIds.has(row.id)) return { kind: "done", reason: "trailer" };
  if (!restated) return { kind: "done", reason: "not-restated" };
  return { kind: "keep" };
}

/**
 * Title-only (tier 1 + 2) restatement check, for in-progress rows. Mirrors matchRecommendations'
 * first two tiers exactly and stops there — see the module note on why tier 3 is excluded.
 */
export function isRestated(prev: RecIdentity, next: readonly RecIdentity[]): boolean {
  const exact = `${prev.dim}::${prev.title}`;
  const normed = `${prev.dim}::${normalizeRecTitle(prev.title)}`;
  return next.some((n) => `${n.dim}::${n.title}` === exact || `${n.dim}::${normalizeRecTitle(n.title)}` === normed);
}

/** The event note written when a rescan closes an in-progress row, so the archive explains itself. */
export function resolutionNote(d: InProgressDecision, scanRef: string): string {
  if (d.kind !== "done") return "";
  return d.reason === "trailer"
    ? `Resolved by commit trailer (${FOLLOWUP_TRAILER}) — confirmed by scan ${scanRef}`
    : `Resolved: no longer raised by scan ${scanRef}`;
}

// ─── The prompt ──────────────────────────────────────────────────────────────────────────────────

const IMPACT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Build the fix prompt for a batch of follow-ups. Pure, deterministic.
 * One section per repository, ordered by the batch's projected points; items inside a repo by
 * impact then effort. Text is plain markdown that reads well pasted into a terminal-side agent.
 */
export function buildFixPrompt(items: readonly FollowUpItem[], ctx: { org: string; generatedAt: string; scanNote?: string }): string {
  const byRepo = new Map<string, FollowUpItem[]>();
  for (const it of items) byRepo.set(it.repo, [...(byRepo.get(it.repo) ?? []), it]);
  const repos = [...byRepo.entries()].sort((a, b) => sumPts(b[1]) - sumPts(a[1]));

  const lines: string[] = [];
  lines.push(`# Ascent follow-ups — ${ctx.org} — ${items.length} item${items.length === 1 ? "" : "s"} across ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`);
  lines.push("");
  lines.push(
    "These are gaps an Ascent maturity scan found in the repositories below. Each item states the gap as the scan " +
      "saw it, why it matters for AI-driven development, and questions worth exploring before changing anything. " +
      "Resolve what you can, in small verifiable changes; skip anything that does not apply and say why.",
  );
  lines.push("");
  lines.push("Rules:");
  lines.push("- Work one repository at a time, on a branch. Read the repo's own guidance (CLAUDE.md / AGENTS.md / CONTRIBUTING) first.");
  lines.push("- Prefer the smallest change that closes the gap for real; add or extend tests where the gap is about verification.");
  lines.push(`- In EVERY commit that resolves an item, add a trailer line \`${FOLLOWUP_TRAILER}: <id>\` (several ids: comma-separated). Ascent's next scan of the branch reads it and marks the item resolved.`);
  lines.push("- Do not edit files only to satisfy a scanner. If a gap is already covered another way, leave it and note that in your summary.");
  lines.push("- End with a short summary: resolved / skipped / needs a human, per id.");
  lines.push("");

  for (const [repo, list] of repos) {
    const sorted = [...list].sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || (IMPACT_ORDER[a.effort] ?? 9) - (IMPACT_ORDER[b.effort] ?? 9));
    const pts = sumPts(sorted);
    lines.push(`## ${repo}${pts > 0 ? ` — up to +${pts} maturity points if all close` : ""}`);
    lines.push("");
    sorted.forEach((it, i) => {
      lines.push(`### ${i + 1}. ${it.title}`);
      lines.push(`- id: \`${it.id}\` · dimension: ${it.dimId} ${it.dimLabel} · impact ${it.impact} · effort ${it.effort}${it.projectedPoints != null ? ` · +${it.projectedPoints} pts` : ""}`);
      if (it.rationale) lines.push(`- Why it matters: ${it.rationale}`);
      if (it.explore.length) {
        lines.push("- Explore first:");
        for (const q of it.explore) lines.push(`  - ${q}`);
      }
      lines.push("");
    });
  }
  lines.push(`_Generated by Ascent on ${ctx.generatedAt}${ctx.scanNote ? ` · ${ctx.scanNote}` : ""}._`);
  return lines.join("\n");
}

function sumPts(list: readonly FollowUpItem[]): number {
  return list.reduce((s, it) => s + (it.projectedPoints ?? 0), 0);
}
