// The WORDS the two round-2 variants say about a run — pure, so "Release notes" and "Earned another
// run" cannot phrase the same fact two ways, and a test can pin the verdict without a DOM.
//
// Every sentence answers to the matrix's attribution: a lift is printed only when the fold called it
// attributable; a refused cell contributes its refusal WORD to a tally and never a number.

import { fmtDelta } from "@/components/ui";
import type { OutcomeCell, OutcomeColumn, OutcomeMatrix } from "./outcomeMatrix";
import { verdictWord } from "./outcomeText";

export const repoName = (full: string): string => full.split("/")[1] ?? full;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The cells one run wrote, in the matrix's group order (the latest run's repos lead). */
export function runCells(m: OutcomeMatrix, runId: string): OutcomeCell[] {
  return m.groups.flatMap((g) => (g.cells[runId] ? [g.cells[runId]!] : []));
}

/** The column the reader is judging: the one they selected if it exists, else the latest. */
export function judgedColumn(m: OutcomeMatrix, selectedId: string | null): OutcomeColumn | null {
  return m.columns.find((c) => c.id === selectedId) ?? m.columns.find((c) => c.id === m.latestId) ?? null;
}

/** "2 uncommitted · 1 within noise" — the refused cells, counted by their word. Empty when none. */
export function refusalTally(cells: readonly OutcomeCell[]): string {
  const counts = new Map<string, number>();
  for (const c of cells) {
    const w = verdictWord(c.verdict);
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()].map(([w, n]) => `${n} ${w}`).join(" · ");
}

const gained = (cells: readonly OutcomeCell[]) => cells.filter((c) => c.verdict.kind === "attributable" && c.verdict.delta > 0);
const lost = (cells: readonly OutcomeCell[]) => cells.filter((c) => c.verdict.kind === "attributable" && c.verdict.delta < 0);

/**
 * The sentence a run's entry is titled with — the number when the fold allowed one, the refusal
 * tally when it did not. ≤ 8 words in every branch.
 */
export function liftSentence(col: OutcomeColumn, cells: readonly OutcomeCell[]): string {
  if (col.live) return `Running · cycle ${col.cycle} of ${col.maxCycles}`;
  if (col.phase === "error") return "Run ended in error";
  if (col.phase === "stopped" && col.lift == null) return "Stopped before it could be measured";
  if (col.lift != null && col.lift > 0) return `Climbed ${fmtDelta(col.lift)} across ${plural(gained(cells).length, "repo")}`;
  if (col.lift != null && col.lift < 0) return `Slipped ${fmtDelta(col.lift)} across ${plural(lost(cells).length, "repo")}`;
  const tally = refusalTally(cells);
  return tally ? `No attributable lift · ${tally}` : "No attributable lift";
}

/**
 * The title of a release-notes entry — a CLAIM the director can paste into Slack, not a number to
 * reconcile: the movers are named when there are two or fewer, counted when there are more. The net
 * is never printed beside a per-repo delta that disagrees with it.
 */
export function entryTitle(col: OutcomeColumn, cells: readonly OutcomeCell[]): string {
  if (col.live) return `Running · cycle ${col.cycle} of ${col.maxCycles}`;
  if (col.phase === "error") return "Run ended in error";
  const up = gained(cells);
  const down = lost(cells);
  const movers = [...up, ...down].sort((a, b) => Math.abs(deltaOf(b)) - Math.abs(deltaOf(a)));
  if (movers.length === 0) {
    if (col.phase === "stopped") return "Stopped before it could be measured";
    const tally = refusalTally(cells);
    return tally ? `No attributable lift · ${tally}` : "No attributable lift";
  }
  if (movers.length <= 2) {
    return movers.map((c) => `${repoName(c.repo)} ${deltaOf(c) > 0 ? "climbed" : "slipped"} ${fmtDelta(deltaOf(c))}`).join(", ");
  }
  const net = fmtDelta(col.lift ?? 0);
  return down.length ? `${plural(up.length, "repo")} climbed, ${down.length} slipped · ${net} net` : `${plural(up.length, "repo")} climbed · ${net} net`;
}

/** One word for an earlier run's row: climbed · slipped · no lift · live · error · stopped. */
export function runWord(col: OutcomeColumn, cells: readonly OutcomeCell[]): string {
  if (col.live) return "live";
  if (col.phase === "error") return "error";
  if (col.lift != null && col.lift > 0 && gained(cells).length > 0) return "climbed";
  if (col.lift != null && col.lift < 0) return "slipped";
  return col.phase === "stopped" ? "stopped" : "no lift";
}

const deltaOf = (c: OutcomeCell): number => (c.verdict.kind === "attributable" ? c.verdict.delta : 0);

/** The delta tokens in a sentence (`▲+6`, `▼-3`, `≈+1`), so a title can colour each one. */
export const DELTA_TOKEN = /([▲▼≈→][+-]?\d+)/;

export type EarnedKind = "earned" | "earned-regressed" | "not-earned" | "unmeasured" | "running" | "none";

export interface EarnedVerdict {
  kind: EarnedKind;
  /** The verdict line — ≤ 5 words. */
  headline: string;
  /** The one clause that justifies it. */
  reason: string;
}

/** Did this run earn another? Judged from the cells the fold could attribute, and nothing else. */
export function earnedVerdict(m: OutcomeMatrix, col: OutcomeColumn | null): EarnedVerdict {
  if (!col) return { kind: "none", headline: "No run to judge yet", reason: "Pick repos in the sky and start one." };
  if (col.live) return { kind: "running", headline: "Still running", reason: `cycle ${col.cycle} of ${col.maxCycles} · ${plural(col.repoCount, "repo")}` };
  const cells = runCells(m, col.id);
  const up = gained(cells);
  const down = lost(cells);
  if (up.length === 0 && down.length === 0) {
    const tally = refusalTally(cells);
    return { kind: "unmeasured", headline: "Too early to say", reason: tally ? `nothing measurable — ${tally}` : "nothing measurable yet" };
  }
  const lift = col.lift ?? 0;
  if (lift > 0 && down.length === 0) {
    return { kind: "earned", headline: "Earned another run", reason: `${up.length} of ${plural(cells.length, "repo")} climbed · ${fmtDelta(lift)} attributable` };
  }
  if (lift > 0) {
    const names = down.map((c) => repoName(c.repo)).join(", ");
    return { kind: "earned-regressed", headline: "Earned another run, with a regression", reason: `${names} slipped while ${plural(up.length, "repo")} climbed · ${fmtDelta(lift)} net` };
  }
  return { kind: "not-earned", headline: "Did not earn another run", reason: `${plural(down.length, "repo")} slipped · ${fmtDelta(lift)} net` };
}
