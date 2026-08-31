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
import type { AiStance, AutonomyTierId } from "@/lib/types";
// Type-only: the admission compiler is pure and has no db edge, so this stays a leaf import.
import type { AdmissionMode } from "@/lib/org/admission";
// TYPE-ONLY, and it has to stay that way: `lane-report.ts` reaches for `node:fs/promises`, and this
// module is imported by the ledger's client model. The import is erased at compile time, so the two
// share a vocabulary without the client sharing a filesystem.
import type { LaneVerdict } from "@/lib/local/lane-report";
// The repository's own failing output is REPOSITORY-AUTHORED TEXT going into a model prompt, so it
// gets the same treatment every foreign fragment gets before it is quoted (`lane-brief.ts`).
// `untrusted.ts` is dependency-free, so this stays safe for the client model that imports this file.
import { neutralize } from "@/lib/llm/untrusted";

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

/**
 * THE CAPABILITY RULE — appended for `commitPolicy: "lane"` only, and nowhere else.
 *
 * WHY IT EXISTS. The lane agent runs `claude -p --permission-mode acceptEdits`: file edits in one
 * worktree, no shell, no network. Some gaps simply cannot be closed under that grant, and the loop's
 * measured failure mode is not that the agent gives up — it is that the agent does something
 * *adjacent* and calls the item RESOLVED. A real run, verdict `resolved`:
 *
 *   "The nine floating refs are still tags: resolving a tag to a commit SHA requires asking GitHub
 *    what it points at right now, this session has neither network nor shell, and inventing a SHA
 *    breaks the workflow rather than pinning it — so instead the burn-down stopped being a
 *    maintainer chore with no owner (.github/workflows/pin-actions.yml runs security:actions
 *    --resolve weekly…)"
 *
 * The workflow is genuinely useful. The nine actions are still unpinned, so the rescan re-raises the
 * gap, the next cycle arms it again, and the dimension churns forever: across three campaign runs
 * both repos churned D4 with 40+ "closed" follow-ups and no sustained score movement.
 *
 * The prompt already ended with "if you cannot write that sentence honestly, the item is SKIPPED" and
 * it was not landing, because that sentence asks the agent to notice an abstract dishonesty. This
 * block instead names the *capability* — the concrete, checkable fact the agent already knows about
 * its own session — and gives the exact line to emit instead. The worked example is the real failure,
 * verbatim, because a rule with the actual case in it is the one that gets applied.
 *
 * This is the ONLY place the rule is stated. `loop-lane.ts` builds its AUTOPILOT CONTEXT around this
 * prompt and deliberately does not repeat it: two copies drift, and the copy that drifts is the one
 * the agent reads.
 */
const LANE_CAPABILITY_RULE: readonly string[] = [
  "WHAT THIS SESSION CANNOT DO:",
  "- You have NO shell and NO network. You can read and write files in this worktree; you can do nothing else. There is no `git`, no package manager, no test runner, no HTTP.",
  "- If closing an item REQUIRES one of those — resolving a tag to a commit SHA, querying an API, fetching a digest or a checksum, running a tool to generate a lockfile or a baseline, reading CI history — then you cannot complete it, however well you understand it.",
  "- In that case emit `SKIPPED: <id> - needs <capability>: <one line>` and move on. A skip with a reason is a GOOD outcome: it stops this item being re-dispatched next cycle, and it tells a human exactly what to run.",
  "- Do NOT substitute an adjacent artefact and call the item RESOLVED. Automating a chore is valuable work and you may still do it — but the ITEM is skipped, because the gap it names is still open and the next scan will prove that.",
  "- RESOLVED means the gap THIS item names is closed by THIS change: the specific thing it asks for. Not a plan to do it later, not a scheduled job that will do it, not documentation saying it should be done.",
  "- Worked example. Item: *nine GitHub Actions are pinned to floating tags; pin them to commit SHAs.* Resolving a tag to a SHA means asking GitHub what that tag points at right now, and you have no network — and inventing a SHA breaks the workflow rather than pinning it. Adding `.github/workflows/pin-actions.yml` to do the burn-down weekly is useful and you may add it. The nine actions are still unpinned, so the honest line is `SKIPPED: <id> - needs network: cannot resolve tags to SHAs offline; added a weekly pinning workflow instead`. It is NOT `RESOLVED`.",
  "",
];

/**
 * PERMISSION TO MAKE A LARGER CHANGE — the invitation, and the safety net that makes it honest.
 *
 * THE EVIDENCE. A 21-run campaign across two real repositories (kp, systedo-case) produced 34 commits
 * and moved kp's overall 83→82 while systedo-case went 84→88. After twenty runs on small and medium
 * codebases the owner expected "well structured, deduplicated, blazingly fast code" and instead read
 * HESITANCE: every change item-shaped, nothing spanning files, nothing deleted, no restructuring, no
 * de-duplication, no performance work. Nothing in this brief ever said that was allowed. Read as an
 * agent reads it, the old brief said the opposite — "the smallest change that closes the gap", "small
 * and reversible", "one rung, not a redesign" — and an agent that is told to be small is small.
 *
 * SO THE INVITATION IS EXPLICIT AND IT IS SCOPED. The rungs of a craft ladder are exactly the place a
 * larger change belongs: the repository is already green, nothing here is owed, and the only thing
 * left to do is raise the ceiling — which is usually structural. "Small and reversible" stays as the
 * default shape of a change and is NOT withdrawn; what is withdrawn is the implication that small is
 * the only shape permitted.
 *
 * AND THE NET IS WHY IT IS SAFE TO SAY. `lane-guard.ts` runs the repository's own verification command
 * before the session and again after it, and a pass that became a failure discards the work in the
 * throwaway worktree without committing it. An agent that knows a regression will be caught and
 * reversed is the one that will take the larger swing; an agent that believes a mistake ships is
 * correct to make the smallest change it can. The sentence is only printed when a command actually
 * resolved and actually passed — a promise of a net that is not there would be worse than silence.
 *
 * EVERY HONESTY RULE ABOVE SURVIVES INTACT. `RESOLVED` still means the named gap is closed by this
 * change; a substitution is still `SKIPPED`; the capability rule still bounds what the session can do.
 * A restructure is a bigger change, never a looser claim.
 */
const STRUCTURAL_INVITATION: readonly string[] = [
  "LARGER CHANGES ARE INVITED, NOT MERELY TOLERATED:",
  "- Restructuring, de-duplication and performance work are IN SCOPE here. If three modules carry the same logic three ways, unify them. If a file has grown into four responsibilities, split it. If a hot path re-reads or re-derives the same thing every call, fix the shape rather than the symptom.",
  "- Such a change MAY span many files, MAY move code between them, and MAY delete code — and is expected to when that is what raises the ceiling. A deletion that removes a whole class of future bug is one of the most valuable things you can do here; do not leave dead code behind out of caution.",
  "- Judge by the ceiling, not by the diff size. The smallest change is still the right default for a narrow fix; it is the wrong default when the real defect is the structure, and 'I made the minimal edit' is not a defence for leaving the structure as it was.",
  "- What does NOT change: do not lower an existing bar, weaken a test, or relax a threshold to make anything pass. A restructure that quietly drops coverage is a regression wearing a refactor's clothes.",
];

/** The net, printed ONLY when the lane actually resolved a verification command and it actually
 *  passed on the pristine tree. See `STRUCTURAL_INVITATION` for why the conditional matters. */
const verificationPromise = (command: string): string[] => [
  "THE SAFETY NET, SO YOU CAN TAKE THE LARGER SWING:",
  `- Before your session started, Ascent ran this repository's own check — \`${command}\` — on the untouched worktree, and it PASSED. It will run the exact same command again after you exit and BEFORE anything is committed.`,
  "- If it passes, your work is committed. If it FAILS, the whole cycle is reversed: the edits are discarded in this throwaway worktree, nothing is committed, nothing is merged and nothing opens a pull request. A regression cannot escape this lane.",
  "- So attempt the change that actually raises the ceiling. You are not the last line of defence, and a bold change that turns out to be wrong costs a cycle rather than a repository.",
  "- This is not permission to guess. It is permission to attempt something large enough to be worth verifying — and then to have it verified.",
  "",
];

/**
 * THE GUARD COULD NOT VERIFY THIS CYCLE — the note the brief carries instead of the safety net.
 *
 * The repository's resolved command did not pass on the lane's PRISTINE worktree, so there is no
 * baseline to compare the session against and nothing this cycle produces can be checked. That is
 * worth telling the agent, for one reason only: it changes how bold the work should be.
 *
 * WHAT THIS REPLACED, AND WHY. This used to be a `# TOP PRIORITY` lead ordering the agent to restore
 * the command ahead of the whole batch, with an attempt counter that reached 14. The premise was
 * false. A worktree carries tracked files plus the dependency caches the loop links and none of the
 * gitignored local state a suite may need — `xkazm04/systedo-case` passes 3744/3744 in the operator's
 * checkout and fails 8 in a worktree on missing Google application-default credentials. There is no
 * cheap way to learn whether a given failure reproduces outside the worktree, so the loop no longer
 * guesses: it states what it could not do, and asks for care rather than for a repair.
 *
 * Derived by `unverifiedCycleBrief` (src/lib/local/lane-baseline.ts), which is also what decides that
 * a cycle whose baseline WAS established gets no note at all.
 */
export interface UnverifiedCycleBrief {
  repo: string;
  /** The command the guard resolved and ran. `null` only when the lane row lost it. */
  command: string | null;
  /** What the command printed in the worktree, ALREADY bounded and neutralized. Re-neutralized here
   *  anyway: the fence below is only safe because backtick runs are collapsed, and a boundary that
   *  depends on every caller remembering is not a boundary. */
  failure: readonly string[];
  /** Consecutive lanes on which no baseline could be established, this one included. Carried for the
   *  OPERATOR's lesson row (`unverifiedCycleLesson`); the brief does not print it, and it is NOT an
   *  attempt count — nothing is being attempted. */
  lanes: number;
  /** `YYYY-MM-DD` the run began — `null` when this is the first lane to record one. */
  since: string | null;
}

/**
 * The note, printed with the other session-shaping rules rather than above the batch.
 *
 * Three things it must do and two it must not. It must say the guard could not verify this cycle,
 * say what that means for the work (be conservative, prefer small reversible changes, report what
 * could not be checked), and show what the command printed so the session need not re-run it blind.
 * It must NOT ask for a repair — the check may well be green in the operator's own checkout — and it
 * must not invite the cheap pass, because an agent that "fixes" a passing suite by skipping a test
 * has done strictly negative work.
 */
const unverifiedCycleNote = (r: UnverifiedCycleBrief): string[] => {
  const cmd = r.command ? `\`${r.command}\`` : "the check Ascent resolved for this repository";
  const out = [
    "NO VERIFICATION NET THIS CYCLE:",
    `- Ascent could not establish a baseline for this repository: ${cmd} did not pass in the isolated worktree your session runs in, before your session started. A worktree carries the repository's tracked files plus linked dependency caches — not gitignored local state such as credentials, \`.env\` files or service configuration — so this is NOT evidence that the repository's own checks fail, and repairing them is NOT your task.`,
    "- What it means for you: nothing you do this cycle can be verified by the guard. Be correspondingly conservative — prefer small, self-contained, reversible changes over a large restructuring, and say plainly in your summary anything you could not check.",
    "- Do NOT try to make that command pass: no `.skip`, no removed assertion, no relaxed threshold, no widened timeout, no deleted test file. It may be passing already where the repository is actually checked, and weakening it there would be strictly negative work.",
    "",
  ];
  if (r.failure.length > 0) {
    out.push("What the command printed in the worktree, verbatim (it may describe the worktree rather than the code):", "", "```", ...r.failure.map(neutralize), "```", "");
  }
  return out;
};

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
  ctx: {
    org: string;
    generatedAt: string;
    scanNote?: string;
    commitPolicy?: "agent" | "lane";
    /**
     * The repository's OWN verification command, when the lane resolved one AND it passed on the
     * pristine worktree — i.e. when the A/B degradation guard is genuinely armed for this cycle
     * (`src/lib/local/lane-guard.ts`). Omitted/null prints NO promise of a net, because there is
     * none: the guard may be off, the repository may declare no check, or its check may already be
     * failing. Telling an agent its mistakes will be caught when they will not is the one lie that
     * would make this brief actively dangerous.
     */
    verifyCommand?: string | null;
    /**
     * THE GUARD COULD NOT ESTABLISH A BASELINE for this cycle — see `UnverifiedCycleBrief`. Mutually
     * exclusive with `verifyCommand` by construction: a baseline cannot be both unavailable and
     * passing, and the lane derives both from the same measurement. Prints the NEUTRAL note, never a
     * repair instruction.
     */
    unverifiedCycle?: UnverifiedCycleBrief | null;
  },
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
  // The capability rule, lane only. The human's paste-into-my-own-terminal agent HAS a shell and a
  // network, so telling it otherwise would be a lie that suppresses work it can actually do.
  if (laneCommits) lines.push(...LANE_CAPABILITY_RULE);
  // THE INVITATION TO MAKE A LARGER CHANGE. A craft lane is where it belongs unreservedly: the repo is
  // green, nothing is owed, and raising the ceiling is usually structural. A gap lane gets the same
  // permission with its own precedence intact — the named gap is still what closes it, and a
  // restructure that leaves the gap open is still SKIPPED, not RESOLVED.
  if (craftMode) {
    lines.push(...STRUCTURAL_INVITATION);
    lines.push("");
  } else {
    lines.push(
      "- A LARGER CHANGE IS ALLOWED WHEN THE GAP'S REAL CAUSE IS STRUCTURAL. If an item is only closable by unifying duplicated logic, splitting an overgrown module or reshaping a hot path, do that — the change may span files, may move code and may delete code. What does not move: `RESOLVED` still means THIS item's gap is closed by THIS change, and a restructure that leaves it open is `SKIPPED` with the reason.",
    );
    lines.push("");
  }
  // The net, and only when it is real — see `verificationPromise`. Its opposite, and mutually
  // exclusive with it: when no baseline could be established the brief says so HERE, in the same
  // place and the same register, rather than as a priority above the batch — see
  // `unverifiedCycleNote`.
  if (laneCommits && ctx.verifyCommand) lines.push(...verificationPromise(ctx.verifyCommand));
  if (ctx.unverifiedCycle) lines.push(...unverifiedCycleNote(ctx.unverifiedCycle));

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

// ─── The work LEASE and who may hold it (moonshot #3) ────────────────────────────────────────────
//
// Everything below is PURE. The claim itself is one compare-and-set in `src/lib/db/followup-claims.ts`
// that BOTH the local loop engine and a remote agent over MCP call — the database decides who wins.
// What lives here is the arithmetic and the authorization that must read identically in a unit test,
// in the ledger UI and at the MCP door: when a lease has lapsed, who may take one at all, and what
// the agent is told about the perimeter it is working inside.

/** What is holding a row. The ledger renders it; `claimability` authorizes against it. */
export type ClaimExecutor = "local" | "remote-agent" | "human";

/**
 * The default lease: ONE WORKING SESSION. Long enough that an agent working five gaps in a real
 * repository is not interrupted; short enough that a crashed agent's rows are back on the queue
 * before anybody notices they were gone. The cap exists because a lease is the only thing standing
 * between "an agent is working this" and "this row is invisible to everyone forever" — four hours is
 * already a generous outer bound for a session nobody is watching.
 */
export const AGENT_LEASE_MS_DEFAULT = 45 * 60_000;
export const AGENT_LEASE_MS_MAX = 4 * 60 * 60_000;
export const AGENT_LEASE_MS_MIN = 5 * 60_000;

/**
 * The verdicts a remote agent may report. A STRICT SUBSET of the lane report's own `LaneVerdict`,
 * asserted against it rather than re-declared: `.ascent/lane-report.json` v1 and this door describe
 * the same event — "what the session says it did with one item" — and a second, nearly-identical
 * vocabulary is how the two would drift into disagreeing about what `skipped` means. Absent from it
 * deliberately: `attempted` (a coercion the file parser applies to a verdict it could not read; a
 * caller with a declared schema has no excuse for one) and `absent` (which the lane assigns to an id
 * nobody mentioned, and a per-id call cannot be).
 */
export const ATTEMPT_VERDICTS = ["resolved", "skipped", "needs_human"] as const satisfies readonly LaneVerdict[];
export type AttemptVerdict = (typeof ATTEMPT_VERDICTS)[number];

export function isAttemptVerdict(v: unknown): v is AttemptVerdict {
  return typeof v === "string" && (ATTEMPT_VERDICTS as readonly string[]).includes(v);
}

/**
 * Has this lease lapsed? `null` is NOT expiry and never will be: a null lease on an in-progress row
 * means A HUMAN TOOK IT from the browser hand-off, which is a claim with no clock on it. Reading
 * null as "expired" would let the sweep pull work out from under a person.
 */
export function leaseExpired(leaseUntil: string | null, now: Date): boolean {
  if (!leaseUntil) return false;
  const t = Date.parse(leaseUntil);
  return Number.isFinite(t) && t <= now.getTime();
}

/** Milliseconds left on a lease; null when there is none (see `leaseExpired`), 0 once lapsed. */
export function leaseRemainingMs(leaseUntil: string | null, now: Date): number | null {
  if (!leaseUntil) return null;
  const t = Date.parse(leaseUntil);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t - now.getTime());
}

/** Clamp a caller-supplied lease into the band above. Asking for nothing gets the default. */
export function clampLeaseMs(ms: number | null | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return AGENT_LEASE_MS_DEFAULT;
  return Math.min(AGENT_LEASE_MS_MAX, Math.max(AGENT_LEASE_MS_MIN, Math.round(ms)));
}

export type ClaimRefusal = "tier-blocked" | "tier-unknown" | "no-ai-zone" | "admission-blocked";

export type ClaimVerdict =
  | { allowed: true; requiresHumanReview: boolean }
  | { allowed: false; reason: ClaimRefusal };

/**
 * MAY THIS EXECUTOR CLAIM WORK IN THIS REPO? Pure, ONE input struct — and the struct is the whole
 * extension seam: W4-O's compiled `RepoAdmission` swaps in as the source of `autonomyTier` without
 * a single caller changing.
 *
 * The rules, and why each is where it is:
 *   • **T0 refuses a remote agent.** T0 is the tier that means "no unattended AI authorship here". A
 *     queue an agent PULLS from has to honour that at the claim, not by trusting the agent to read
 *     the brief it is handed afterwards.
 *   • **An unknown tier refuses too** — the rule that will look wrong to somebody one day, so: a
 *     repository with no passport has not PROVEN it can be worked unattended. Unknown is not green.
 *     Failing open here would make the newest, least-understood repository in the fleet the one an
 *     agent may work with no supervision at all, which is exactly backwards.
 *   • **T1/T2 allow the claim and flag review.** The flag rides into the brief and the ledger; it
 *     changes nobody's permission to claim, because a human reviewing the RESULT is a different
 *     control from a human authorizing the ATTEMPT.
 *   • **T3 allows it plainly.**
 *   • A repo inside a declared no-AI zone is refused outright, whatever its tier.
 *   • **An admission MODE below `agents-allowed` refuses outright too**, whatever the tier. The tier
 *     answers "how much supervision has this repository earned"; the mode answers "may an agent open
 *     work here at all", and the second question is not the first. A repo can sit at T3 and still be
 *     `assisted-only` — an owner deciding a person drives here — and a gate reading only the tier
 *     would wave an agent straight through that decision. An ABSENT mode refuses nothing: an org
 *     that has recorded no decision is governed by its tier exactly as it was.
 *
 * The tier this receives is the EFFECTIVE one — the recorded `grantedTier` where a decision exists,
 * the derived tier otherwise. `repoGate` resolves that, so the seam this header promised is finally
 * used (UAT `PRIYA-L2-C4`: the claim gate read the DERIVED tier and never consulted the admission
 * table, so an owner who recorded T2 still got a T0 refusal at the only door that acts on it).
 *
 * `local` and `human` are unaffected by tier: self-hosted consent is the operator's own box, and a
 * person claiming their own organization's row does not need the fleet's permission to do it.
 */
export function claimability(f: {
  autonomyTier: AutonomyTierId | null;
  executor: ClaimExecutor;
  /** True when the repo matched a declared no-AI zone's repo globs. */
  sealed?: boolean;
  /** The recorded admission mode, or null/undefined when this org has decided nothing for the repo.
   *  ABSENCE IS NOT A REFUSAL — see the mode rule above. */
  admissionMode?: AdmissionMode | null;
}): ClaimVerdict {
  if (f.executor !== "remote-agent") return { allowed: true, requiresHumanReview: false };
  if (f.sealed) return { allowed: false, reason: "no-ai-zone" };
  if (f.admissionMode && f.admissionMode !== "agents-allowed") return { allowed: false, reason: "admission-blocked" };
  if (f.autonomyTier == null) return { allowed: false, reason: "tier-unknown" };
  if (f.autonomyTier === "T0") return { allowed: false, reason: "tier-blocked" };
  return { allowed: true, requiresHumanReview: f.autonomyTier !== "T3" };
}

/** The refusal in words the agent can act on. Every input is about the caller's own org. */
export function claimRefusalText(reason: ClaimRefusal, repo: string): string {
  if (reason === "admission-blocked") {
    return `${repo} has a recorded admission decision that does not permit an agent to open work here. The autonomy tier is not the obstacle — an owner decided this repository is worked with a person driving. Moving that is a decision on the Governance tab, not something a claim can route around.`;
  }
  if (reason === "no-ai-zone") {
    return `${repo} is inside a no-AI zone this organization declared. Nothing here may be claimed by an agent — a person has to do this work.`;
  }
  if (reason === "tier-blocked") {
    return `${repo} is at autonomy tier T0: this organization has not cleared it for unattended AI authorship, so its follow-ups cannot be claimed by an agent.`;
  }
  return `${repo} has no assessed autonomy tier, so there is no evidence it can be worked unattended. An unknown tier is refused rather than assumed safe — scan the repository to establish one.`;
}

/** The perimeter a claiming agent is handed with its brief. Every field a STORED value. */
export interface AgentPerimeter {
  repo: string;
  autonomyTier: AutonomyTierId | null;
  /** The stance's own review text for this tier, verbatim. Null when the org wrote none. */
  reviewText: string | null;
  requiresHumanReview: boolean;
  /** ISO — when the claim lapses and the rows return to the queue. */
  leaseUntil: string;
  stance: AiStance | null;
}

/**
 * `buildFixPrompt` plus the PERIMETER — the brief a remote agent gets for rows it holds.
 *
 * NO NEW PROSE. Every line below is either the fix prompt this repo already generates or a value the
 * organization stored: its permitted tools and models, its no-AI zones, its own review sentence for
 * this tier. An agent-facing document that invented policy would be a third source of truth for
 * something the Governance tab owns, and the first place the three would disagree.
 */
export function buildAgentBrief(
  items: readonly FollowUpItem[],
  ctx: {
    org: string;
    generatedAt: string;
    scanNote?: string;
    /**
     * THE ORGANIZATION'S STANDARD for these rows' dimensions — the same `buildLaneBrief` text a LOCAL
     * lane's agent gets, assembled by the caller from `loadLaneBriefInput`.
     *
     * It was absent here until 2026-08-31 (`PRIYA-L1-706`): a local lane worked under the org's
     * playbooks, mined house pattern, memory and skills, and a remote lane — the same rows, the same
     * organization — worked under none of them, which made a remote close structurally unable to be
     * evidence that a playbook is applied. `null` when the org has published nothing for these
     * dimensions, in which case the section is omitted rather than headed and empty.
     */
    standard?: string | null;
  },
  perimeter: AgentPerimeter,
): string {
  const out = [buildFixPrompt(items, { ...ctx, commitPolicy: "agent" })];
  if (ctx.standard) out.push("", "---", "", "## Your organization's standard", "", ctx.standard);
  out.push("", "---", "", "## Working perimeter", "");
  out.push(
    `- Repository \`${perimeter.repo}\` · autonomy tier ${perimeter.autonomyTier ?? "not assessed"}${
      perimeter.requiresHumanReview ? " · a human review is required before this work merges" : ""
    }.`,
  );
  out.push(`- Your lease on these rows expires at ${perimeter.leaseUntil}.`);
  const s = perimeter.stance;
  if (s) {
    if (s.permittedTools.length) out.push(`- Permitted AI tools: ${s.permittedTools.join(", ")}.`);
    if (s.permittedModels.length) out.push(`- Permitted models: ${s.permittedModels.join(", ")}.`);
    const paths = [...new Set(s.noAiZones.flatMap((z) => z.pathGlobs))].filter(Boolean);
    if (paths.length) {
      out.push(
        `- NO-AI ZONES — do not author changes under: ${paths.join(", ")}. These are declared policy, not a runtime control; honour them yourself.`,
      );
    }
    if (s.provenance.requireTrailer) out.push("- Every AI-assisted commit must carry this organization's AI attribution trailer.");
    if (s.provenance.requireHumanApproval) out.push("- An AI-attributed change may not merge without a human approval.");
  } else {
    // ABSENCE IS ANSWERED. An empty perimeter heading reads to a model as "there are no rules here",
    // which is the one thing it must never conclude from silence.
    out.push(
      "- This organization has not published an AI stance. Absence is not permission: check with the organization rather than assuming any tool, model or path is allowed.",
    );
  }
  if (perimeter.reviewText) {
    out.push(`- Review requirement for this tier, in the organization's own words: ${perimeter.reviewText}`);
  }
  out.push("", "## Protocol", "");
  out.push(`- Commit the \`${FOLLOWUP_TRAILER}: <id>\` trailer for every item you resolve.`);
  out.push(
    "- Call `report_attempt` for every id BEFORE your lease expires, with `resolved`, `skipped` or `needs_human` and one sentence of reason. A lease you let expire releases the rows back to the queue.",
  );
  out.push(
    "- Your verdict is your ACCOUNT, not the ruling. Nothing you can call closes a row: a follow-up closes only when this organization's next scan of the default branch stops raising the gap and the dimension measurably moves.",
  );
  return out.join("\n");
}
