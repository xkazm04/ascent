// WHAT THE PLANNER READS, AND WHAT THE EXECUTOR IS HELD TO (spark theater-upgrade, 2026-09-18; WP3).
//
// Two texts, one contract:
//   • `buildPlanningPrompt` — the read-only session's brief: the batch, the org's standard, the module
//     partition it will be measured against, any revision notes the operator left on an earlier plan
//     for these items, and THE PLAN CONTRACT (the exact JSON shape, one fenced block, declare every
//     architecture move). The planner is told, in so many words, that the fence is ENFORCED from the
//     real diff — a planner that believes a declaration is a formality will under-declare.
//   • `buildPlanBlock` — the execution session's FIXED TIER (`hitl-approval/fixed-policy-amendable-
//     plan`): the plan it runs under, the modules it works in, the moves it may make, the check that
//     proves it. The route inside that boundary is the executor's to amend; the boundary is not, and
//     the block says what happens to work that leaves it.

import type { FollowUpItem } from "@/lib/org/followups";
import type { ArchitectureMove, LanePlan, ModulePartition, PlanItem } from "@/lib/local/runner-types";
import { describeMove } from "@/lib/local/lane-plan-classify";

/** The partition is listed, not dumped: past this many modules the brief says how many it left out. */
const PARTITION_LIST_MAX = 120;

/** An earlier plan on these items that the operator sent back, with why. */
export interface ReviseNote {
  intent: string;
  note: string;
  decidedBy: string | null;
}

export const PLAN_CONTRACT = [
  "THE PLAN CONTRACT — end your final message with EXACTLY ONE fenced ```json block of this shape (the last such block is the one read):",
  "```json",
  "{",
  '  "v": 1,',
  '  "intent": "one or two sentences: what this lane will achieve (≤ 600 chars)",',
  '  "items": [',
  '    { "recommendationId": "<the id: exactly as given>", "approach": "how you will resolve it", "files": ["repo/relative/path.ts"], "moves": [] }',
  "  ],",
  '  "modules": ["src/lib/example/"],',
  '  "check": "the command or observation that proves the work",',
  '  "risks": ["what could go wrong"],',
  '  "notDoing": ["what this plan deliberately leaves alone"]',
  "}",
  "```",
  "- One `items` entry per batch item, keyed by its id. At most 40 `files` and 10 `moves` per item.",
  '- A move is `{ "kind": <kind>, "from": <module or null>, "to": <module or null> }`, with kind one of: `module-created` (to), `module-removed` (from), `module-split` (from, and each new module as to — one move per new module), `module-merged` (each source as from, the new module as to), `cross-module-move` (from and to). Name modules as the directory prefixes listed below.',
  "- An architecture move is ONLY one of those five, measured against the module partition below. Changing a contract, a dependency, a build file or touching many files is NOT a move — do not declare it; it is approved automatically.",
  "- DECLARE EVERY ARCHITECTURE MOVE HONESTLY. An item with a declared move waits for the operator's approval; an item without one executes now. An UNDECLARED move is detected from the real diff after execution and the work is discarded — parked on a held branch for review — so hiding a move costs the whole cycle.",
  "- A plan that does not parse against this shape (an unknown move kind, a missing field, a second draft after the block) is treated as unreadable and EVERY item waits for the operator.",
].join("\n");

function itemLines(it: FollowUpItem): string[] {
  const lines = [
    `### ${it.title}`,
    `- id: \`${it.id}\` · ${it.kind === "craft" ? "rung" : "gap"} · dimension: ${it.dimId} ${it.dimLabel}${it.craftAxis ? ` · axis ${it.craftAxis}` : ""}`,
  ];
  if (it.rationale) lines.push(`- ${it.kind === "craft" ? "Why this rung" : "Why it matters"}: ${it.rationale}`);
  if (it.explore.length) {
    lines.push("- Explore first:");
    for (const q of it.explore) lines.push(`  - ${q}`);
  }
  return lines;
}

/** The read-only planning session's brief. */
export function buildPlanningPrompt(input: {
  org: string;
  repo: string;
  batch: readonly FollowUpItem[];
  briefText: string | null;
  partition: ModulePartition;
  revise: readonly ReviseNote[];
}): string {
  const { partition } = input;
  const listed = partition.modules.slice(0, PARTITION_LIST_MAX);
  const lines: string[] = [
    `# Ascent — PLAN FIRST — ${input.repo} (${input.org})`,
    "",
    "This is a READ-ONLY planning session. You may Read, Grep and Glob; you may not edit, write or run anything. The worktree is checked after you exit, and a planning session that changed it fails the whole lane with nothing executed.",
    "Read the code these items touch, then plan how you would resolve each one. Do not start the work — a later session executes the plan.",
    "",
    `## The batch — ${input.batch.length} item(s)`,
    "",
  ];
  for (const it of input.batch) lines.push(...itemLines(it), "");
  if (input.briefText) lines.push("## YOUR ORGANIZATION'S STANDARD", "", input.briefText, "");
  lines.push(
    `## The module partition (${partition.source}) — the ruler an architecture move is measured against`,
    "",
    ...(listed.length ? listed.map((m) => `- ${m}`) : ["- (no modules were found — any new top-level directory still counts as a module created)"]),
    ...(partition.modules.length > listed.length ? [`- …and ${partition.modules.length - listed.length} more; the full partition is enforced.`] : []),
    "",
  );
  if (input.revise.length) {
    lines.push("## THE OPERATOR SENT AN EARLIER PLAN FOR THESE ITEMS BACK — address this", "");
    for (const r of input.revise) lines.push(`- Earlier intent: ${r.intent}`, `  Revision asked${r.decidedBy ? ` by ${r.decidedBy}` : ""}: ${r.note}`);
    lines.push("");
  }
  lines.push(PLAN_CONTRACT);
  return lines.join("\n");
}

/** One executing item and the plan's entry for it (null when the plan gave it none). */
export interface PlannedItem {
  item: FollowUpItem;
  entry: PlanItem | null;
  moves: readonly ArchitectureMove[];
}

/** The execution session's fixed tier. Empty when nothing executes. */
export function buildPlanBlock(input: {
  plan: LanePlan | null;
  items: readonly PlannedItem[];
  directionFence: readonly string[] | null;
  /** True for an APPROVED direction's plan, which runs in a fresh session. */
  directed: boolean;
}): string {
  if (input.items.length === 0) return "";
  const { plan } = input;
  const declared = input.items.flatMap((p) => p.moves);
  const lines: string[] = [
    input.directed
      ? "YOUR PLAN — this is the fixed tier. The operator APPROVED it; you execute exactly this plan. You may amend the route inside it, never its boundary."
      : "YOUR PLAN — this is the fixed tier. You wrote it in the read-only planning session and the engine classified it. You may amend the route inside it, never its boundary.",
  ];
  if (plan?.intent) lines.push(`Intent: ${plan.intent}`);
  lines.push("Items:");
  for (const p of input.items) {
    lines.push(`- \`${p.item.id}\` — ${p.item.title}: ${p.entry?.approach || "(the plan gave this item no entry — work it inside the modules below, with no architecture move)"}`);
    if (p.entry?.files.length) lines.push(`  Expected files: ${p.entry.files.join(", ")}`);
  }
  if (plan?.modules.length) lines.push(`Modules you may work in: ${plan.modules.join(", ")}`);
  lines.push(`Declared architecture moves (the ONLY ones allowed): ${declared.length ? declared.map(describeMove).join("; ") : "none"}`);
  if (input.directionFence?.length) lines.push(`Approved direction fence — moves wholly inside these prefixes are allowed: ${input.directionFence.join(", ")}`);
  if (plan?.check) lines.push(`The check that proves the work: ${plan.check}`);
  if (plan?.notDoing.length) lines.push(`Not doing: ${plan.notDoing.join("; ")}`);
  lines.push(
    "THE FENCE IS ENFORCED. After you exit, the engine diffs this cycle against the repository's module partition. Any architecture move — a module created, removed, split or merged, or code moved across module boundaries — that is not declared above" +
      (input.directionFence?.length ? " and not inside the direction's fence" : "") +
      " is detected, and the whole cycle's work is discarded: parked on a held branch for the operator, never landed. If the work turns out to need such a move, skip the item and say why.",
  );
  return lines.join("\n");
}
