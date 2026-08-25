// THE BRIEFING PROMPT — what she is told when nobody asked her anything.
//
// The interactive prompt (prompt.ts) ends with THE OPERATOR SAYS. This one cannot: there is no
// operator, no question, and no one waiting. Everything that changes follows from that:
//
//   • SILENCE IS AN ALLOWED ANSWER, and it is named. A model handed a fleet summary and asked to
//     "write a briefing" will always write one — that is what the instruction asked for — and the
//     result is a daily message whose median content is "the fleet is stable", which trains the reader
//     to stop opening them. {@link CYCLE_SILENCE_TOKEN} gives silence a first-class spelling, so
//     "nothing changed" costs one line instead of a paragraph, and report-or-absorb turns that line
//     into no message at all.
//   • THE BAR IS STATED IN THE PROMPT, not only enforced after it. cycle-signal.ts is the gate, but a
//     model that knows the bar writes fewer things that fail it, and a rejected paragraph is a billed
//     completion that reached nobody.
//   • NO TOOLS. The cycle is ONE metered call: the standing and the open asks are prefetched into the
//     prompt below. A tool loop here would spend an unbounded number of legs on a question nobody
//     asked.
//
// The identity and the three contracts are reused VERBATIM from the interactive prompt. She is the
// same companion at 08:00 with nobody watching as she is mid-conversation; a second tone contract
// written for the briefing would be a second Athena that only the cron ever meets.

import { ATHENA_ACTION_CONTRACT } from "@/lib/athena/actions";
import { ATHENA_BLOCK_CONTRACT, ATHENA_TONE_CONTRACT } from "@/lib/athena/prompt";

/**
 * What she writes, on a line of its own, when the period produced nothing worth an operator's
 * attention. Matched case-insensitively at the START of the completion (a model that adds a trailing
 * full stop or a closing sentence still counts as silent).
 */
export const CYCLE_SILENCE_TOKEN = "NOTHING TO REPORT";

/** The org's standing, prefetched — the evidence half of the briefing. */
export interface CycleStanding {
  repoCount: number;
  scannedCount: number;
  avgOverall: number;
  /** The maturity level's display name at `avgOverall`. */
  level: string;
  /** Cohort-matched period movement in overall score, or null when there is no comparable baseline. */
  overallDelta: number | null;
  /** The denominator `overallDelta` was measured over. A delta without it cannot be read. */
  cohortSize: number | null;
  /** At most a handful, biggest absolute mover first. */
  movers: { name: string; delta: number }[];
}

/** One offer of hers a human has not answered yet. */
export interface CycleOpenProposal {
  id: string;
  kind: string;
  /** Resolved from the action spec at read time, or the kind when the action is retired. */
  summary: string;
  ageDays: number;
}

export interface CycleBriefingInput {
  orgSlug: string;
  constitution: string | null;
  selfModel: string | null;
  standing: CycleStanding;
  openProposals: CycleOpenProposal[];
  /** Human-readable period this briefing covers, e.g. "the last 24 hours". */
  periodLabel: string;
}

const section = (heading: string, body: string | null | undefined): string | null => {
  const b = body?.trim();
  return b ? `${heading}\n${b}` : null;
};

/** True when the completion is her declared silence rather than a briefing. */
export function isCycleSilence(completion: string): boolean {
  return completion.trim().toUpperCase().startsWith(CYCLE_SILENCE_TOKEN);
}

function standingSection(s: CycleStanding): string {
  const lines = [
    `Repositories: ${s.repoCount} (${s.scannedCount} scanned)`,
    `Fleet average: ${s.avgOverall} of 100 — ${s.level}`,
    s.overallDelta === null
      ? "Period movement: not measurable (no comparable baseline)"
      : `Period movement: ${s.overallDelta > 0 ? "+" : ""}${s.overallDelta} points over ${s.cohortSize ?? 0} repositories present on both sides of the window`,
  ];
  if (s.movers.length > 0) {
    lines.push(
      `Movers: ${s.movers.map((m) => `${m.name} ${m.delta > 0 ? "+" : ""}${m.delta}`).join(", ")}`,
    );
  }
  return `THIS ORGANIZATION'S STANDING RIGHT NOW\n${lines.join("\n")}`;
}

function proposalsSection(open: CycleOpenProposal[]): string | null {
  if (open.length === 0) return null;
  const lines = open.map(
    (p) => `- ${p.summary} (${p.kind}, waiting ${p.ageDays} day${p.ageDays === 1 ? "" : "s"})`,
  );
  return [
    "WHAT YOU HAVE ALREADY ASKED AND NOBODY HAS ANSWERED",
    ...lines,
    "Do not re-propose any of these. If one has been waiting long enough to matter, say so in one sentence instead.",
  ].join("\n");
}

/**
 * The unattended framing. This is the section that does not exist in the interactive prompt, and it
 * is the whole difference between a companion and a newsletter.
 */
function unattendedContract(periodLabel: string, silenceToken: string): string {
  return `THIS IS AN UNATTENDED BRIEFING. Nobody asked you anything. Nobody is waiting for this. It covers ${periodLabel}.

Write ONLY what changes what this team would do next. A restatement of the standing they can already read on their dashboard is not that. Neither is an encouraging summary of a period in which nothing moved.

If nothing in ${periodLabel} changes what they would do, reply with exactly this on the first line and stop:

${silenceToken}

That is a complete and correct answer, and it is the RIGHT answer most days. It costs nothing and it is never held against you. A briefing sent on a quiet day costs the next real one its reader.

If you do write a briefing: lead with the thing that changed, name the repository or dimension it happened in, and keep it under six sentences. Do not open with a greeting, do not name the period, and do not close by offering to help.`;
}

/**
 * Compose the briefing prompt. Pure — no database, no clock, no network — so the exact string is
 * assertable in a test, which is how "the silence path is taught" stays true.
 */
export function buildCycleBriefingPrompt(input: CycleBriefingInput): string {
  const parts: (string | null)[] = [
    `You are Athena, the resident companion for the "${input.orgSlug}" organization on Ascent. You are org-scoped: every member of this organization talks to the same you, and what you remember you remember for all of them.`,
    section("WHO YOU ARE", input.constitution),
    section("WHAT YOU HAVE LEARNED ABOUT THIS ORGANIZATION", input.selfModel),
    ATHENA_TONE_CONTRACT,
    ATHENA_BLOCK_CONTRACT,
    ATHENA_ACTION_CONTRACT,
    unattendedContract(input.periodLabel, CYCLE_SILENCE_TOKEN),
    standingSection(input.standing),
    proposalsSection(input.openProposals),
  ];
  return parts.filter((p): p is string => Boolean(p)).join("\n\n");
}
