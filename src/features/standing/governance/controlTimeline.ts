// PURE shaping for the control-timeline card (moonshot #1). No React, no I/O — so the grouping and
// the coverage arithmetic are testable on their own and the card stays well under the 200-LOC cap
// this directory enforces.

import { controlDef, controlLabel, controlOrder, stateTone } from "@/lib/controls/catalog";
import type { ControlCoverage, ControlObservationRow } from "@/lib/db/control-observations";

// The truncation disclosure is shared verbatim with `/api/org/controls` — see the module docstring
// there for why it cannot live in either consumer.
export { timelineDisclosure, truncationSentence } from "@/lib/controls/window";

export interface TimelineRow {
  repoFullName: string;
  controlId: string;
  label: string;
  state: "pass" | "fail" | "unmeasurable";
  value: string | null;
  /** The instant of the newest observation for this pair. */
  lastAt: string;
  /** The newest observation that was an actual CHANGE, or null when we have only ever seen one state.
   *  Null is "nothing has changed since we started looking", never "changed at the epoch". */
  lastChangeAt: string | null;
  lastChangeActor: string | null;
  /** How the newest observation reached us. */
  source: string;
  /** The observations backing this row inside the window, newest first. */
  observations: ControlObservationRow[];
  /** The coverage row for this pair, when the caller supplied one. Null means the card must NOT
   *  print a coverage figure — an absent N is silence, not zero. */
  coverage: ControlCoverage | null;
  /** True when the catalogue marks this control a DESCRIPTOR (`repo-visibility`): its state is
   *  always `pass` and the fact lives in `value`, so a surface renders the VALUE and never the word
   *  "operating". The catalogue has said so since it was written; MC-B13 gives it its first reader. */
  descriptor: boolean;
  /** The catalogue's sentence for what a `fail` on this control MEANS, or null when the row is not
   *  failing. This is the disclaimer Nadia's screenshot went out without: "Published advisories ·
   *  not operating" in red, with the catalogue's own "NOT a statement that the repo is insecure"
   *  sitting unread in a file. A red state is never rendered without it. */
  failMeans: string | null;
  /** `stateTone`'s verdict for this row — read from the catalogue, not re-derived. A renderer that
   *  re-implements the ternary is a renderer that can drift from the three-state vocabulary. */
  tone: "good" | "bad" | "unknown";
}

/**
 * Group a flat observation feed into one row per (repo, control), newest-first inside each row.
 *
 * The feed arrives newest-first from `listControlTimeline`, and this preserves that order rather
 * than re-sorting, so "the newest observation" is simply the first one seen per pair. Rows are then
 * ordered by repository, then by CATALOGUE order — the order a reader should meet the controls in
 * (protection bars first, descriptors last), not alphabetical, which would open on "advisories".
 */
export function groupTimeline(
  rows: readonly ControlObservationRow[],
  coverage: readonly ControlCoverage[] = [],
): TimelineRow[] {
  // A space is a safe separator and needs no exotic byte: neither half can contain one (a GitHub
  // `owner/name` and a kebab-case control id are both space-free), so no two pairs collide.
  const key2 = (repo: string, control: string) => `${repo} ${control}`;
  const covBy = new Map(coverage.map((c) => [key2(c.repoFullName, c.controlId), c]));
  const byPair = new Map<string, TimelineRow>();

  for (const r of rows) {
    const key = key2(r.repoFullName, r.controlId);
    const hit = byPair.get(key);
    if (hit) {
      hit.observations.push(r);
      // The newest CHANGE, walking backwards through an already newest-first feed: the first
      // transition we meet is the most recent one.
      if (hit.lastChangeAt === null && r.transition) {
        hit.lastChangeAt = r.occurredAt;
        hit.lastChangeActor = r.actorLogin;
      }
      continue;
    }
    const def = controlDef(r.controlId);
    byPair.set(key, {
      repoFullName: r.repoFullName,
      controlId: r.controlId,
      label: controlLabel(r.controlId),
      descriptor: def?.descriptor === true,
      // Only on a fail: the sentence is what a `fail` MEANS, and printing it beside a pass would
      // read as a warning on a control that is operating.
      failMeans: r.state === "fail" ? (def?.failMeans ?? null) : null,
      tone: stateTone(r.state),
      state: r.state,
      value: r.value,
      lastAt: r.occurredAt,
      lastChangeAt: r.transition ? r.occurredAt : null,
      lastChangeActor: r.transition ? r.actorLogin : null,
      source: r.source,
      observations: [r],
      coverage: covBy.get(key) ?? null,
    });
  }

  return [...byPair.values()].sort(
    (a, b) => a.repoFullName.localeCompare(b.repoFullName) || controlOrder(a.controlId) - controlOrder(b.controlId),
  );
}

/**
 * The coverage sentence, or null when there is nothing honest to say.
 *
 * Null rather than a placeholder: a card that prints "coverage unknown" in the same slot where it
 * elsewhere prints a number invites the reader to average the two. No coverage row means no
 * sentence.
 */
export function coverageSentence(c: ControlCoverage | null): string | null {
  if (!c || c.observations === 0) return null;
  const n = `${c.observations} observation${c.observations === 1 ? "" : "s"}`;
  // The gap is the part that stops a reader over-reading the count. The heartbeat is 24h, so a gap
  // materially above a day means we stopped looking, not that nothing changed.
  const gap = c.maxGapDays === null ? "a single observation, so no continuity is claimed" : `largest gap ${c.maxGapDays}d`;
  // MC-B13: when the coverage read hit its cap the count is a FLOOR over the newest rows, not a
  // total. Said in the same sentence as the number rather than in a footnote a screenshot crops out.
  const floor = c.windowTruncated ? " · at least (read window capped)" : "";
  return `${n} · ${gap} · via ${c.sources.join(", ")}${floor}`;
}

/** How a state should be worded. `unmeasurable` renders as an em dash with this as its tooltip —
 *  never a zero, never a red: absence of evidence is not a finding. */
export const STATE_TITLE: Record<TimelineRow["state"], string> = {
  pass: "Observed operating.",
  fail: "Observed NOT operating.",
  unmeasurable: "Not readable at the last observation (denied or absent access). This is not a finding — it is missing evidence.",
};

/** The counts the card's header states. `unmeasurable` is deliberately its own number and is never
 *  folded into `failing`. */
export function timelineTotals(rows: readonly TimelineRow[]): { pairs: number; failing: number; unmeasurable: number; repos: number } {
  return {
    pairs: rows.length,
    failing: rows.filter((r) => r.state === "fail").length,
    unmeasurable: rows.filter((r) => r.state === "unmeasurable").length,
    repos: new Set(rows.map((r) => r.repoFullName)).size,
  };
}
