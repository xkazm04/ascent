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
import { attributeDelta, SCORE_NOISE_BAND, type EngineEnd } from "@/lib/maturity/attribution";
import type { CraftAxis } from "@/lib/scoring/craft";

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
  /** Overall-score points the repo gains if this gap closes; null when unknown — and ALWAYS null on a
   *  craft item, which has no projected gain and must never be given one (see org-insights-craft.ts). */
  projectedPoints: number | null;
  /** `gap` (the default when absent, so every existing caller and fixture is unchanged) or `craft` —
   *  the next rung on an already-green dimension, dispatchable since r12 but never debt. */
  kind?: "gap" | "craft";
  /** Which face of the craft this raises (`src/lib/scoring/craft.ts`). Only ever set with
   *  `kind: "craft"`; null on a craft row written before the axis column existed. */
  craftAxis?: CraftAxis | null;
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
  | {
      kind: "keep";
      reason:
        | "restated"
        | "claimed-but-restated"
        | "no-movement"
        | "within-noise"
        | "mock-scan"
        /** A CRAFT rung nobody claimed. See the craft rule in `decideInProgress`. */
        | "craft-unclaimed";
    };

/** The row's dimension score on the previous scan and on this one — the independent witness. */
export interface DimMovement {
  before: number;
  after: number;
}

/** The engines that produced the two scans the movement was measured between. Optional: a caller with
 *  no provenance to hand (a legacy row, a unit fixture) gets the pre-attribution behaviour rather
 *  than a fabricated verdict. */
export interface MovementEngines {
  before: EngineEnd;
  after: EngineEnd;
}

/**
 * Decide the fate of ONE in-progress row from the previous scan. Pure.
 * - `restated`: the new scan restated it (a tier-1/2 title match).
 * - `resolvedIds`: ids named by trailers in the new scan's commit sample.
 * - `movement`: the dimension's score before and after, when both scans measured it.
 *
 * THE TRAILER IS A HINT, NOT A VERDICT (2026-08-26). It used to close a row unconditionally, and in
 * the autopilot loop the AGENT writes the trailer — the loop was certifying its own homework. Now a
 * trailer is an honoured claim only when the rescan agrees: a row that is still restated stays open
 * however many trailers name it, and the note says the claim was made.
 *
 * "NOT RESTATED" IS WEAK ON ITS OWN. Restatement is title-only, and titles are not stable across
 * scans — a model that merely REWORDS a gap produces exactly the "not restated" signal a resolved gap
 * does. So when the dimension's score is known on both sides it has to have MOVED; a gap that
 * vanished from the roadmap while its number stood still is far more likely rephrasing than repair.
 * Unknown movement (a first scan, a dimension dropped on either side) falls back to the title rule
 * rather than inventing a measurement.
 *
 * AND THE MOVEMENT HAS TO BE ATTRIBUTABLE (2026-08-28). "It moved" is not the same claim as "the
 * repository changed", and this rule is the loop certifying its own work, so it gets the strictest
 * reading available. `engines` runs the same `attributeDelta` the ledger uses:
 *   • a pair with a MOCK end is two different rulers — a follow-up must never close on it, however
 *     far the number travelled;
 *   • a real pair whose movement is inside `SCORE_NOISE_BAND` is a re-run of the same measurement,
 *     which is exactly the evidence the old `after > before` test accepted as repair.
 * Omitting `engines` keeps the pre-attribution behaviour: a caller with no provenance in hand gets
 * the strict-movement rule, never a verdict invented from absent data.
 */
export function decideInProgress(
  row: { id: string; kind?: "gap" | "craft" },
  restated: boolean,
  resolvedIds: ReadonlySet<string>,
  movement?: DimMovement | null,
  engines?: MovementEngines | null,
): InProgressDecision {
  const claimed = resolvedIds.has(row.id);
  if (restated) return { kind: "keep", reason: claimed ? "claimed-but-restated" : "restated" };
  // THE CRAFT RULE (r12): a craft rung closes on its TRAILER and on nothing else.
  //
  // Both of the gap rules are unavailable here, for opposite reasons.
  //   • MOVEMENT cannot witness it. A craft entry is raised only on a dimension already at or above
  //     the green floor, and the rung it names raises the CEILING — a performance budget, a chaos
  //     drill, an architecture-decay check. The rubric has no headroom to record that, so demanding
  //     a score move would mean no craft rung can ever close: the ladder would never advance and the
  //     odometer would read zero forever, which is the exact dead end r12 exists to remove.
  //   • "NOT RESTATED" cannot witness it either — and here the weakness is worse than it is for a
  //     gap. A craft entry is the answer to an unbounded question the model re-answers from scratch
  //     every scan; its absence next time is ordinary variance, not evidence anyone did the work.
  // What is left is the one signal with a human or an agent behind it: the `Ascent-Resolves:` trailer
  // the lane writes for the ids its session actually named. So an unclaimed craft row simply stays
  // in progress. That asymmetry is deliberate — the ledger only ever increases, so a rung must never
  // be counted on inference.
  if (row.kind === "craft") {
    return claimed ? { kind: "done", reason: "trailer" } : { kind: "keep", reason: "craft-unclaimed" };
  }
  if (movement) {
    if (engines) {
      const verdict = attributeDelta(movement.after - movement.before, engines.before, engines.after);
      if (verdict.kind === "mock-scan") return { kind: "keep", reason: "mock-scan" };
      // A real pair inside the band, or moving the wrong way, is not repair. `no-movement` stays the
      // reason for a flat-or-down dimension so the existing ledger wording is unchanged for the case
      // it already described; `within-noise` is the new, narrower one.
      if (verdict.kind === "within-noise") {
        return { kind: "keep", reason: verdict.delta > 0 ? "within-noise" : "no-movement" };
      }
      // `attributable` is the only kind left that carries a delta — `unmeasured` cannot be reached
      // here (this branch already established both a movement and two engines), but the narrowing is
      // written explicitly rather than assumed.
      if (verdict.kind === "attributable" && verdict.delta < 0) return { kind: "keep", reason: "no-movement" };
    } else if (movement.after <= movement.before) {
      return { kind: "keep", reason: "no-movement" };
    }
  }
  return claimed ? { kind: "done", reason: "trailer" } : { kind: "done", reason: "not-restated" };
}

/** The event note for a row a rescan KEPT open despite a signal that it might be done, so the ledger
 *  explains why a claim did not close it. Empty for a plain restatement (nothing to explain). */
export function keepNote(d: InProgressDecision, scanRef: string, movement?: DimMovement | null): string {
  if (d.kind !== "keep") return "";
  if (d.reason === "claimed-but-restated") {
    return `Claimed resolved by commit trailer (${FOLLOWUP_TRAILER}), but scan ${scanRef} still raises it — kept in progress`;
  }
  if (d.reason === "no-movement") {
    const m = movement ? ` (${movement.before} → ${movement.after})` : "";
    return `No longer raised by scan ${scanRef}, but the dimension did not move${m} — kept in progress until a rescan measures a change`;
  }
  if (d.reason === "within-noise") {
    const m = movement ? ` (${movement.before} → ${movement.after})` : "";
    return `No longer raised by scan ${scanRef}, and the dimension moved${m} — but by less than the ±${SCORE_NOISE_BAND}-point run-to-run noise band, so the movement is not evidence of repair`;
  }
  if (d.reason === "craft-unclaimed") {
    return `Scan ${scanRef} no longer raises this craft rung, but no commit claimed it (${FOLLOWUP_TRAILER}) — a craft entry is re-derived every scan, so its absence is not evidence it was built; kept in progress`;
  }
  if (d.reason === "mock-scan") {
    return `No longer raised by scan ${scanRef}, but one end of the comparison came from the deterministic mock floor — the two scans are not on the same ruler, so no movement between them can close this row`;
  }
  return "";
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
/** Effort runs the other way — `low` is the desirable end. Ranking it through IMPACT_ORDER listed the
 *  most expensive item first, which is not the order anyone wants to work a batch in. */
const EFFORT_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * Build the fix prompt for a batch of follow-ups. Pure, deterministic.
 * One section per repository, ordered by the batch's projected points; items inside a repo by impact
 * (highest first) then effort (cheapest first). Text is plain markdown that reads well pasted into a
 * terminal-side agent.
 *
 * `commitPolicy` says WHO commits, and it is not cosmetic. The default (`agent`) is the human's
 * paste-into-my-own-terminal case, where the agent has a shell and writing its own trailers is the
 * whole contract. `lane` is the loop's unattended agent, which runs under `--permission-mode
 * acceptEdits` and CANNOT run git — instructing it to commit is instructing it to fail (L2-A-01,
 * uat/runs/2026-08-29-loop-l2: five dispatched items written into a worktree and then deleted). For
 * that caller the lane commits afterwards and writes the trailers itself, so the prompt asks for the
 * one thing only the session knows: which ids it actually resolved.
 */
export function buildFixPrompt(
  items: readonly FollowUpItem[],
  ctx: { org: string; generatedAt: string; scanNote?: string; commitPolicy?: "agent" | "lane" },
): string {
  const byRepo = new Map<string, FollowUpItem[]>();
  for (const it of items) byRepo.set(it.repo, [...(byRepo.get(it.repo) ?? []), it]);
  const repos = [...byRepo.entries()].sort((a, b) => sumPts(b[1]) - sumPts(a[1]));
  // THE BRIEF FOLLOWS THE BATCH. `openBatch` never mixes kinds — gaps always outrank craft, so a
  // batch is all gaps or (only once a repo has none open) all craft. That makes the mode a property
  // of the batch rather than a caller flag nobody would remember to pass, and it means an existing
  // caller gets the byte-identical gap prompt it has always got.
  const craftMode = items.length > 0 && items.every((it) => it.kind === "craft");

  const lines: string[] = [];
  lines.push(
    craftMode
      ? `# Ascent craft ladder — ${ctx.org} — ${items.length} rung${items.length === 1 ? "" : "s"} across ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`
      : `# Ascent follow-ups — ${ctx.org} — ${items.length} item${items.length === 1 ? "" : "s"} across ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}`,
  );
  lines.push("");
  lines.push(
    craftMode
      ? "These repositories have no open gaps left — every dimension an Ascent maturity scan measures is already in the " +
          "green band. So none of the items below is a fault, and nothing here is owed. Each is a RUNG: one thing that " +
          "would make an already-strong dimension exemplary, or the place its current practice would break first under " +
          "more AI-authored change. Your job is to raise the ceiling, not to close a gap. Build what you judge worth " +
          "building, in small verifiable changes; skip anything that does not apply here and say why."
      : "These are gaps an Ascent maturity scan found in the repositories below. Each item states the gap as the scan " +
          "saw it, why it matters for AI-driven development, and questions worth exploring before changing anything. " +
          "Resolve what you can, in small verifiable changes; skip anything that does not apply and say why.",
  );
  lines.push("");
  const laneCommits = ctx.commitPolicy === "lane";
  lines.push("Rules:");
  lines.push("- Work one repository at a time, on a branch. Read the repo's own guidance (CLAUDE.md / AGENTS.md / CONTRIBUTING) first.");
  if (craftMode) {
    // The three rules that make a craft rung REVIEWABLE. Without them a "raise the ceiling" brief
    // invites a sprawling refactor nobody can adjudicate, and the ✓/✕ ledger the Storyboard renders
    // has nothing to point at.
    lines.push("- Leave an ARTEFACT. Name it in your summary: the file, check, budget, drill or documented decision this rung adds. A rung with nothing to point at cannot be reviewed and does not count.");
    lines.push("- Keep it small and reversible — one rung, not a redesign. Prefer something that RUNS (a check, a budget, a drill) over something that only describes.");
    lines.push("- Do not lower any existing bar to make a new one pass, and do not change tests, thresholds or configuration to move a score. Nothing here is scored; a rung that games a number is worse than no rung.");
  } else {
    lines.push("- Prefer the smallest change that closes the gap for real; add or extend tests where the gap is about verification.");
  }
  lines.push(
    laneCommits
      ? `- DO NOT run git. Leave your changes in the working tree: this session has no shell permission, and the Ascent lane commits them for you after you exit and writes the \`${FOLLOWUP_TRAILER}: <id>\` trailers itself.`
      : `- In EVERY commit that resolves an item, add a trailer line \`${FOLLOWUP_TRAILER}: <id>\` (several ids: comma-separated). Ascent's next scan of the branch reads it and marks the item resolved.`,
  );
  lines.push(
    craftMode
      ? "- Do not edit files only to satisfy a scanner. If a rung is already built another way, leave it and note that in your summary — that is a real answer, and the next scan will propose the rung above it instead."
      : "- Do not edit files only to satisfy a scanner. If a gap is already covered another way, leave it and note that in your summary.",
  );
  lines.push(
    laneCommits
      ? "- End with ONE line per item, exactly `RESOLVED: <id> - <what changed>` or `SKIPPED: <id> - why`. The `<what changed>` clause is printed as a headline on the outcome dashboard: at most 8 words, verb-first, past tense, naming the artefact — e.g. `RESOLVED: rec-42 - Added permissions scope to 3 workflows`. Those ids become the commit's trailers; an id you name as SKIPPED is left out of them."
      : "- End with a short summary: resolved / skipped / needs a human, per id.",
  );
  lines.push("");

  for (const [repo, list] of repos) {
    const sorted = [...list].sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) || (EFFORT_ORDER[a.effort] ?? 9) - (EFFORT_ORDER[b.effort] ?? 9));
    const pts = sumPts(sorted);
    // A craft heading carries NO points. There are none to carry: a craft rung has no projected gain
    // by construction (org-insights-craft.ts sets projectedPoints null), and printing a maturity-point
    // total over craft would be the first move toward craft paying for a score.
    lines.push(`## ${repo}${craftMode ? " — already green; these raise the ceiling" : pts > 0 ? ` — up to +${pts} maturity points if all close` : ""}`);
    lines.push("");
    sorted.forEach((it, i) => {
      lines.push(`### ${i + 1}. ${it.title}`);
      lines.push(
        `- id: \`${it.id}\` · dimension: ${it.dimId} ${it.dimLabel} · impact ${it.impact} · effort ${it.effort}` +
          (it.craftAxis ? ` · axis ${it.craftAxis}` : "") +
          (it.projectedPoints != null ? ` · +${it.projectedPoints} pts` : ""),
      );
      if (it.rationale) lines.push(`- ${craftMode ? "Why this rung" : "Why it matters"}: ${it.rationale}`);
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
