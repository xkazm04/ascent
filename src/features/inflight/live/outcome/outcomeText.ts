// The matrix's WORDS — the takeaway sentence, the cell's verdict word, and the one-line title clip.
// Pure and shared by both variants so the two never phrase the same fact two ways.

import { fmtDelta } from "@/components/ui";
import type { Attribution } from "@/lib/maturity/attribution";
import type { OutcomeMatrix } from "./outcomeMatrix";

/** ~24 characters, then an ellipsis — the §4 cell-label rule. The full title rides in a tooltip. */
export function shortTitle(title: string, max = 24): string {
  const t = title.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one sentence the section leads with. ≤ 8 words in the populated case. */
export function takeaway(m: OutcomeMatrix): string {
  if (m.columns.length === 0) return "No runs yet";
  const runs = plural(m.totals.runs, "run");
  const gaps = plural(m.totals.gaps, "gap");
  if (m.totals.lift != null && m.totals.lift > 0) return `Fleet climbed ${fmtDelta(m.totals.lift)} across ${runs}`;
  if (m.totals.lift != null && m.totals.lift < 0) return `Fleet slipped ${fmtDelta(m.totals.lift)} across ${runs}`;
  // `m.totals.gaps` is `diff.closedGapCount` — a SCAN-DIFF quantity, not a follow-up verdict and not
  // the lanes' adjudicated close count. It gets its own words (MC-B41): three different facts on one
  // screen wearing the word "closed" is how a reader unlearns the claim/verdict split the item
  // verdicts have just taught them.
  return `${gaps} no longer raised across ${runs} · no attributable lift yet`;
}

/** The refusal word a cell prints INSTEAD of a delta. Empty for an attributable pair. */
export function verdictWord(a: Attribution): string {
  switch (a.kind) {
    case "attributable":
      return "";
    case "unmeasured":
      return "not measured";
    case "within-noise":
      return "within noise";
    case "mock-scan":
      return a.degraded ? "mock · degraded" : "mock scan";
    case "undelivered":
      return "uncommitted";
  }
}

/** "3 commits · 2 gaps" — the mono footnote under a cell. */
export const cellFootnote = (commits: number, gaps: number): string => `${plural(commits, "commit")} · ${plural(gaps, "gap")}`;

/**
 * THE FIRST CLAUSE OF A LANE FAILURE — what the error dialog is titled, and what the icon says on
 * hover. The engine's errors are written to be read in full and are long by design ("Cycle 1 was
 * FORCE-FAILED: it exceeded its 90 min deadline while no stage in particular was in flight, so the
 * lane was cut loose rather than left holding the run. …"), which is right for a dialog and wrong for
 * a spreadsheet cell 168px wide. The lead clause — up to the first colon, else the first sentence —
 * is the part that names WHAT happened; the rest names what it means, and that is the dialog's job.
 */
export function errorHeadline(error: string, max = 72): string {
  const text = error.trim().replace(/\s+/g, " ");
  const colon = text.indexOf(": ");
  const stop = text.search(/[.!?](\s|$)/);
  const candidates = [colon > 0 ? text.slice(0, colon) : null, stop > 0 ? text.slice(0, stop) : null].filter(
    (c): c is string => c != null && c.length <= max,
  );
  // Longest clause that still fits — a colon inside a sentence is the better cut when both survive.
  const lead = candidates.sort((a, b) => b.length - a.length)[0];
  return lead ?? shortTitle(text, max);
}
